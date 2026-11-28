import { randomBytes, createHash } from "node:crypto";
import { isIP } from "node:net";
import { ApiError, kube, owned, pvcPath, type Resource } from "./kube";
import { diskNames } from "./spec";
import { hasOwner, managedDisks } from "./storage";
import { vmStorageClass, type ManagedStorageClass } from "./storage-class";
import { brokerImage } from "./cluster-image";
import { growthFor, growthState } from "./storage-growth-layout";
const ns = () => process.env.VM_NAMESPACE || "vm-interface";
const podsPath = (id = "") => "/api/v1/namespaces/" + ns() + "/pods" + (id ? "/" + id : "");
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export function exchangeFileName(name: string) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(name) ||
    name === "." ||
    name === ".." ||
    name.endsWith(".sha256")
  )
    throw new ApiError(422, "Invalid exchange filename");
  return name;
}
export function exchangeConfigured(vm: Resource) {
  return (
    (vm.spec as { template?: { metadata?: { annotations?: Record<string, string> } } })?.template
      ?.metadata?.annotations?.["vm-interface.io/exchange-gib"] !== undefined
  );
}
function reservation(vm: Resource, id: string) {
  if (!exchangeConfigured(vm) || !managedDisks(vm, id).some((d) => d.mode === "virtiofs"))
    throw new ApiError(422, "VirtioFS exchange is not configured");
  const size = (vm.spec as { template: { metadata: { annotations: Record<string, string> } } })
    .template.metadata.annotations["vm-interface.io/exchange-gib"];
  if (!/^[1-4]$/.test(size) || !vm.metadata?.uid || vm.metadata.deletionTimestamp)
    throw new ApiError(409, "Exchange unavailable");
  return { size, uid: vm.metadata.uid };
}
async function optional(path: string) {
  try {
    return (await kube("GET", path)) as Resource;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
function owner(id: string, uid: string) {
  return [
    {
      apiVersion: "kubevirt.io/v1",
      kind: "VirtualMachine",
      name: id,
      uid,
      controller: false,
      blockOwnerDeletion: false,
    },
  ];
}
export function exchangePVC(
  id: string,
  account: string,
  uid: string,
  size: string,
  storageClass: ManagedStorageClass = "local-path",
) {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: diskNames(id).exchange,
      labels: {
        "vm-interface.io/account": account,
        "vm-interface.io/computer": id,
        "vm-interface.io/exchange": "true",
      },
      ownerReferences: owner(id, uid),
    },
    spec: {
      storageClassName: storageClass,
      accessModes: ["ReadWriteOnce"],
      volumeMode: "Filesystem",
      resources: { requests: { storage: size + "Gi" } },
    },
  };
}
export function exchangePod(id: string, account: string, uid: string, token: string) {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: id + "-files",
      labels: {
        "vm-interface.io/account": account,
        "vm-interface.io/computer": id,
        "vm-interface.io/exchange-broker": "true",
      },
      ownerReferences: owner(id, uid),
    },
    spec: {
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      restartPolicy: "Always",
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 107,
        runAsGroup: 107,
        fsGroup: 107,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "files",
          ...brokerImage(),
          command: ["node", "--import", "tsx", "src/run-exchange-broker.ts"],
          env: [
            { name: "EXCHANGE_TOKEN", value: token },
            { name: "NODE_DISABLE_COMPILE_CACHE", value: "1" },
          ],
          ports: [{ containerPort: 8080 }],
          resources: {
            requests: { cpu: "25m", memory: "64Mi" },
            limits: { cpu: "500m", memory: "256Mi" },
          },
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ["ALL"] },
          },
          volumeMounts: [{ name: "exchange", mountPath: "/exchange" }],
          readinessProbe: { tcpSocket: { port: 8080 } },
        },
      ],
      volumes: [{ name: "exchange", persistentVolumeClaim: { claimName: diskNames(id).exchange } }],
    },
  };
}
type Pod = Resource & {
  spec?: {
    containers?: { name?: string; image?: string; env?: { name: string; value?: string }[] }[];
    volumes?: { name?: string; persistentVolumeClaim?: { claimName?: string } }[];
  };
  status?: { podIP?: string; phase?: string; conditions?: { type?: string; status?: string }[] };
};
function verify(resource: Resource, id: string, account: string, uid: string) {
  if (
    !hasOwner(resource, "VirtualMachine", uid) ||
    resource.metadata?.labels?.["vm-interface.io/account"] !== account ||
    resource.metadata?.labels?.["vm-interface.io/computer"] !== id ||
    resource.metadata?.deletionTimestamp
  )
    throw new ApiError(409, "Exchange resource ownership not confirmed");
}
export async function ensureExchange(id: string, account: string, vm: Resource, initial = false) {
  const { size, uid } = reservation(vm, id),
    pvcName = diskNames(id).exchange;
  let pvc = await optional(pvcPath(pvcName));
  if (!pvc) {
    if (!initial) throw new ApiError(409, "Exchange PVC missing; refusing to recreate data");
    // Resource name is not part of the collection endpoint.
    pvc = (await kube(
      "POST",
      pvcPath("").replace(/\/$/, ""),
      exchangePVC(id, account, uid, size, vmStorageClass(vm.spec)),
    )) as Resource;
  }
  verify(pvc, id, account, uid);
  const spec = pvc.spec as {
    storageClassName?: string;
    volumeMode?: string;
    resources?: { requests?: { storage?: string } };
  };
  const grown = growthFor(vm.spec, pvcName);
  if (grown && !growthState(vm, pvcName, pvc)?.submitted)
    throw new ApiError(409, "Submit reserved exchange growth first");
  if (
    spec.storageClassName !== vmStorageClass(vm.spec) ||
    spec.volumeMode !== "Filesystem" ||
    spec.resources?.requests?.storage !== (grown?.sizeGiB ?? size) + "Gi"
  )
    throw new ApiError(409, "Exchange PVC layout changed");
  let pod = await optional(podsPath(id + "-files"));
  if (!pod) {
    try {
      pod = (await kube(
        "POST",
        podsPath(),
        exchangePod(id, account, uid, randomBytes(32).toString("base64url")),
      )) as Resource;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
      pod = await optional(podsPath(id + "-files"));
    }
  }
  if (!pod) throw new ApiError(502, "Exchange broker unavailable");
  verify(pod, id, account, uid);
  return pod as Pod;
}
export async function exchangeRequest(
  id: string,
  account: string,
  method: "GET" | "PUT",
  path: string,
  bytes?: Buffer,
  digest?: string,
) {
  const vm = await owned(id, account);
  let pod = await ensureExchange(id, account, vm);
  const until = Date.now() + 20000;
  while (
    pod.status?.phase !== "Running" ||
    !pod.status.conditions?.some((c) => c.type === "Ready" && c.status === "True")
  ) {
    if (Date.now() >= until) throw new ApiError(409, "Exchange broker not ready; retry");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const next = await optional(podsPath(id + "-files"));
    if (!next) throw new ApiError(409, "Exchange broker not ready");
    verify(next, id, account, vm.metadata?.uid ?? "");
    pod = next as Pod;
  }
  const ip = pod.status?.podIP,
    token = pod.spec?.containers
      ?.find((c) => c.name === "files" && c.image === brokerImage().image)
      ?.env?.find((x) => x.name === "EXCHANGE_TOKEN")?.value;
  if (
    !ip ||
    isIP(ip) !== 4 ||
    !token ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    pod.spec?.volumes?.length !== 1 ||
    pod.spec.volumes[0].persistentVolumeClaim?.claimName !== diskNames(id).exchange
  )
    throw new ApiError(502, "Invalid exchange broker");
  if (bytes && createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new ApiError(422, "File checksum mismatch");
  const response = await fetch("http://" + ip + ":8080" + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      ...(digest ? { "x-content-sha256": digest } : {}),
      ...(bytes ? { "content-type": "application/octet-stream" } : {}),
    },
    ...(bytes ? { body: Uint8Array.from(bytes) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(
      [404, 409, 413, 422].includes(response.status) ? response.status : 502,
      "Exchange broker rejected request (" + response.status + ")",
    );
  }
  const current = await owned(id, account);
  if (current.metadata?.uid !== vm.metadata?.uid) {
    await response.body?.cancel();
    throw new ApiError(409, "VM changed during exchange");
  }
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-type": response.headers.get("content-type") ?? "application/octet-stream",
  });
  for (const k of ["content-length", "x-content-sha256", "content-disposition"]) {
    const v = response.headers.get(k);
    if (v) headers.set(k, v);
  }
  return new Response(response.body, { headers });
}
