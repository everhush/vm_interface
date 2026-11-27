import { z } from "zod";
import { readDataDisks, dataDiskDevice } from "./data-disk-layout";
import { ApiError, kube, owned, vmPath, vmiPath, type Resource } from "./kube";
export const bootSpec = z
  .strictObject({
    first: z.enum(["system", "installer"]),
    installerTray: z.enum(["open", "closed"]).optional(),
    expectedResourceVersion: z.string().min(1).max(128),
  })
  .refine((s) => s.first !== "installer" || s.installerTray !== "open", {
    message: "Installer-first boot requires inserted media",
    path: ["installerTray"],
  });
type BootSpec = z.infer<typeof bootSpec>;
type Disk = {
  name: string;
  bootOrder?: number;
  disk?: object;
  cdrom?: { bus?: string; readonly?: boolean; tray?: string };
};
function diskList(vm: Resource) {
  return (vm.spec as { template?: { spec?: { domain?: { devices?: { disks?: Disk[] } } } } })
    ?.template?.spec?.domain?.devices?.disks;
}
export function bootPreference(vm: Resource) {
  const disks = diskList(vm);
  if (!Array.isArray(disks)) return null;
  const boot = disks.find((x) => x.name === "boot"),
    installer = disks.find((x) => x.name === "installer");
  if (!boot || !installer) return null;
  if (boot.bootOrder === 1 && installer.bootOrder === 2) return "system";
  if (boot.bootOrder === 2 && installer.bootOrder === 1) return "installer";
  return null;
}
export function installerTray(vm: Resource) {
  const disk = diskList(vm)?.find((d) => d.name === "installer");
  if (!disk?.cdrom || ![undefined, "open", "closed"].includes(disk.cdrom.tray)) return null;
  return disk.cdrom.tray ?? "closed";
}
export function coldBootPatch(vm: Resource, instance: Resource | null, s: BootSpec) {
  const spec = vm.spec as {
    runStrategy?: string;
    template?: {
      metadata?: { annotations?: Record<string, string> };
      spec?: { volumes?: { name: string; dataVolume?: { name: string } }[] };
    };
  };
  const status = vm.status as
    | { ready?: boolean; created?: boolean; stateChangeRequests?: unknown[] }
    | undefined;
  if (!vm.metadata?.uid || vm.metadata.deletionTimestamp || !vm.metadata.resourceVersion)
    throw new ApiError(409, "VM unavailable for modification");
  if (vm.metadata.resourceVersion !== s.expectedResourceVersion)
    throw new ApiError(409, "Configuration version changed");
  if (
    instance ||
    spec?.runStrategy !== "Halted" ||
    status?.ready ||
    status?.created ||
    status?.stateChangeRequests?.length
  )
    throw new ApiError(
      409,
      "Stop the VM and wait for lifecycle convergence before changing boot order",
    );
  const allDisks = diskList(vm);
  const volumes = spec?.template?.spec?.volumes;
  if (!Array.isArray(allDisks) || !Array.isArray(volumes))
    throw new ApiError(409, "Unsupported installer disk layout");
  const name = vm.metadata.name;
  const auxiliary = spec?.template?.metadata?.annotations?.["vm-interface.io/auxiliary-media"];
  const driver = allDisks?.find((d) => d.name === "auxiliary");
  if (auxiliary !== undefined) {
    let declaration: unknown;
    try {
      declaration = JSON.parse(auxiliary);
    } catch {
      throw new ApiError(409, "Invalid driver media declaration");
    }
    if (
      (declaration as { format?: string } | null)?.format !== "iso" ||
      !driver ||
      driver.bootOrder !== undefined ||
      driver.cdrom?.bus !== "sata" ||
      driver.cdrom.readonly !== true ||
      driver.cdrom.tray !== "closed" ||
      !volumes?.some((v) => v.name === "auxiliary" && v.dataVolume?.name === name + "-auxiliary")
    )
      throw new ApiError(409, "Unsupported driver CD-ROM layout");
  } else if (driver) throw new ApiError(409, "Undeclared auxiliary device");
  const extra = new Set(
    readDataDisks(vm, name ?? "")
      .filter((d) => d.attached)
      .map((d) => dataDiskDevice(d.name)),
  );
  const disks = allDisks?.filter((d) => d.name !== "auxiliary" && !extra.has(d.name));
  if (
    !name ||
    !/^vm-[a-f0-9]{32}$/.test(name) ||
    spec?.template?.metadata?.annotations?.["vm-interface.io/media-slot"] !== "installer" ||
    !Array.isArray(allDisks) ||
    !Array.isArray(disks) ||
    new Set(allDisks.map((d) => d.name)).size !== allDisks.length ||
    !Array.isArray(volumes) ||
    ![2, 3].includes(disks.length) ||
    new Set(disks.map((x) => x.name)).size !== disks.length ||
    !bootPreference(vm) ||
    !disks.some((x) => x.name === "boot" && x.disk) ||
    !disks.some((x) => x.name === "installer" && x.cdrom) ||
    (disks.length === 3 &&
      !disks.some((x) => x.name === "exchange" && x.disk && x.bootOrder === undefined)) ||
    !["boot", "installer"].every((slot) =>
      volumes.some((v) => v.name === slot && v.dataVolume?.name === name + "-" + slot),
    ) ||
    (disks.length === 2
      ? !volumes.some(
          (v) =>
            v.name === "exchange" &&
            (v as { persistentVolumeClaim?: { claimName?: string } }).persistentVolumeClaim
              ?.claimName ===
              name + "-exchange",
        )
      : !volumes.some((v) => v.name === "exchange" && v.dataVolume?.name === name + "-exchange"))
  )
    throw new ApiError(409, "Unsupported installer disk layout");
  const tray = s.installerTray ?? installerTray(vm);
  if (!tray || (s.first === "installer" && tray !== "closed"))
    throw new ApiError(422, "Installer-first boot requires inserted media");
  return {
    metadata: { resourceVersion: s.expectedResourceVersion },
    spec: {
      template: {
        spec: {
          domain: {
            devices: {
              disks: allDisks.map((d) =>
                d.name === "boot"
                  ? { ...d, bootOrder: s.first === "system" ? 1 : 2 }
                  : d.name === "installer"
                    ? {
                        ...d,
                        bootOrder: s.first === "installer" ? 1 : 2,
                        ...(s.installerTray ? { cdrom: { ...d.cdrom, tray } } : {}),
                      }
                    : d,
              ),
            },
          },
        },
      },
    },
  };
}
export async function configureBoot(account: string, id: string, s: BootSpec, dryRun = false) {
  const vm = await owned(id, account);
  let instance: Resource | null = null;
  try {
    instance = (await kube("GET", vmiPath(id))) as Resource;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
  }
  const patch = coldBootPatch(vm, instance, s);
  const updated = (await kube(
    "PATCH",
    vmPath(id) + (dryRun ? "?dryRun=All" : ""),
    patch,
    "application/merge-patch+json",
  )) as Resource;
  return {
    id,
    first: s.first,
    installerTray: installerTray(updated),
    dryRun,
    resourceVersion: updated.metadata?.resourceVersion,
    desired: updated.spec,
    warning: "Boot preference does not prove guest installation; verify the actual boot display",
  };
}
