import { z } from "zod";
import { ApiError, kube, owned, vmPath, vmiPath, type Resource } from "./kube";
import { database } from "./db";
import { sql } from "drizzle-orm";
import { desiredUsage, requireAccountCapacity } from "./quota";
export const hardwareSpec = z.strictObject({
  cpu: z.number().int().min(1).max(4),
  memoryMiB: z.number().int().min(256).max(4096),
  expectedResourceVersion: z.string().min(1).max(128),
});
export type HardwareSpec = z.infer<typeof hardwareSpec>;
export const hardwareSchema = z.toJSONSchema(hardwareSpec);

// Serialize mutation submissions across application replicas. A lock is not a
// completion signal; KubeVirt state/optimistic version checks remain mandatory.
export async function withVmLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  if (!/^vm-[a-f0-9]{32}$/.test(id)) throw new ApiError(404, "Computer not found");
  return database().transaction(async (tx) => {
    const rows = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"vm-interface:" + id},0)) AS locked`,
    );
    if (rows[0]?.locked !== true)
      throw new ApiError(
        409,
        "Another mutation is being submitted; inspect state and use a new idempotency key",
      );
    return run();
  });
}
export function coldHardwarePatch(vm: Resource, instance: Resource | null, s: HardwareSpec) {
  const spec = vm.spec as
    | {
        runStrategy?: string;
        template?: {
          spec?: {
            domain?: {
              cpu?: { cores?: number; sockets?: number; threads?: number };
              resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
              memory?: { guest?: string; maxGuest?: string };
            };
          };
        };
      }
    | undefined;
  const status = vm.status as
    | {
        ready?: boolean;
        created?: boolean;
        stateChangeRequests?: unknown[];
        printableStatus?: string;
      }
    | undefined;
  if (!vm.metadata?.uid || vm.metadata.deletionTimestamp || !vm.metadata.resourceVersion)
    throw new ApiError(409, "VM unavailable for modification");
  if (vm.metadata.resourceVersion !== s.expectedResourceVersion)
    throw new ApiError(409, "Configuration version changed; inspect current VM");
  if (
    instance ||
    spec?.runStrategy !== "Halted" ||
    status?.ready ||
    status?.created ||
    status?.stateChangeRequests?.length
  )
    throw new ApiError(409, "Stop the VM and wait for lifecycle convergence before resizing");
  const domain = spec?.template?.spec?.domain;
  if (
    !domain?.cpu ||
    !domain.resources?.requests?.memory ||
    domain.memory?.maxGuest ||
    (domain.cpu.sockets ?? 1) !== 1 ||
    (domain.cpu.threads ?? 1) !== 1 ||
    domain.resources.limits?.cpu ||
    domain.resources.limits?.memory
  )
    throw new ApiError(409, "Unsupported hardware layout for cold resize");
  const memory = s.memoryMiB + "Mi";
  return {
    metadata: { resourceVersion: s.expectedResourceVersion },
    spec: {
      template: {
        spec: {
          domain: {
            cpu: { cores: s.cpu },
            resources: { requests: { memory } },
            memory: { guest: memory },
          },
        },
      },
    },
  };
}
async function instanceOrNull(id: string) {
  try {
    return (await kube("GET", vmiPath(id))) as Resource;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
export async function configureHardware(
  account: string,
  id: string,
  s: HardwareSpec,
  dryRun = false,
) {
  const vm = await owned(id, account);
  const patch = coldHardwarePatch(vm, await instanceOrNull(id), s);
  await requireAccountCapacity(
    account,
    { ...desiredUsage(vm.spec), cpu: s.cpu, memoryMiB: s.memoryMiB },
    id,
  );
  const updated = (await kube(
    "PATCH",
    vmPath(id) + (dryRun ? "?dryRun=All" : ""),
    patch,
    "application/merge-patch+json",
  )) as Resource;
  return {
    id,
    mode: "cold",
    dryRun,
    resourceVersion: updated.metadata?.resourceVersion,
    desired: updated.spec,
    warning: "Desired-resource quota checked; verify effective CPU/RAM after start",
  };
}
