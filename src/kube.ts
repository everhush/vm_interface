import { readFileSync } from "node:fs";
import { request } from "node:https";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const ns = () => process.env.VM_NAMESPACE || "vm-interface";
export const vmPath = (id = "") =>
  "/apis/kubevirt.io/v1/namespaces/" + ns() + "/virtualmachines" + (id ? "/" + id : "");
export const dvPath = (id: string) =>
  "/apis/cdi.kubevirt.io/v1beta1/namespaces/" + ns() + "/datavolumes/" + id;
export const pvcPath = (id: string) =>
  "/api/v1/namespaces/" + ns() + "/persistentvolumeclaims/" + id;
export const vmiPath = (id: string) =>
  "/apis/kubevirt.io/v1/namespaces/" + ns() + "/virtualmachineinstances/" + id;
export const resetPath = (id: string) =>
  "/apis/subresources.kubevirt.io/v1/namespaces/" +
  ns() +
  "/virtualmachineinstances/" +
  id +
  "/reset";
export const actionPath = (id: string, action: string) =>
  "/apis/subresources.kubevirt.io/v1/namespaces/" + ns() + "/virtualmachines/" + id + "/" + action;
// Lifecycle subresources return an empty response and do not declare JSON production.
export function acceptFor(method: string, path: string) {
  return method === "PUT" &&
    (/^\/apis\/subresources\.kubevirt\.io\/v1\/namespaces\/[^/]+\/virtualmachines\/[^/]+\/(start|stop|restart)$/.test(
      path,
    ) ||
      /^\/apis\/subresources\.kubevirt\.io\/v1\/namespaces\/[^/]+\/virtualmachineinstances\/[^/]+\/reset$/.test(
        path,
      ))
    ? "*/*"
    : "application/json";
}
export async function kube(
  method: string,
  path: string,
  body?: unknown,
  contentType = "application/json",
): Promise<unknown> {
  const dir = "/var/run/secrets/kubernetes.io/serviceaccount/";
  const token = readFileSync(dir + "token", "utf8").trim(),
    ca = readFileSync(dir + "ca.crt");
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "kubernetes.default.svc",
        port: 443,
        path,
        method,
        ca,
        headers: {
          authorization: "Bearer " + token,
          accept: acceptFor(method, path),
          ...(payload
            ? { "content-type": contentType, "content-length": Buffer.byteLength(payload) }
            : {}),
        },
        timeout: 20000,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > 8 * 1024 * 1024) req.destroy(Error("Oversized Kubernetes response"));
        });
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode || 502;
          if (status >= 400)
            return reject(
              new ApiError(
                status === 404 ? 404 : status === 409 ? 409 : status === 422 ? 422 : 502,
                "Kubernetes rejected request (" + status + ")",
              ),
            );
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            reject(new ApiError(502, "Invalid Kubernetes response"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(Error("Kubernetes request timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}
export type Resource = {
  metadata?: {
    name?: string;
    uid?: string;
    resourceVersion?: string;
    deletionTimestamp?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    ownerReferences?: { kind: string; uid: string }[];
  };
  spec?: unknown;
  status?: unknown;
};
export async function owned(id: string, account: string) {
  if (!/^vm-[a-f0-9]{32}$/.test(id)) throw new ApiError(404, "Computer not found");
  const vm = (await kube("GET", vmPath(id))) as Resource;
  if (vm.metadata?.labels?.["vm-interface.io/account"] !== account)
    throw new ApiError(404, "Computer not found");
  return vm;
}
export async function list(account: string) {
  const r = (await kube(
    "GET",
    vmPath() + "?labelSelector=" + encodeURIComponent("vm-interface.io/account=" + account),
  )) as { items: Resource[] };
  return r.items.map((vm) => ({ id: vm.metadata?.name, desired: vm.spec, status: vm.status }));
}

// Only the fixed read-only screenshot subresource is exposed; no caller-controlled
// upstream URLs, query parameters or WebSocket access. The cursor is never moved.
export async function kubeScreenshot(id: string): Promise<Buffer> {
  if (!/^vm-[a-f0-9]{32}$/.test(id)) throw new ApiError(404, "Computer not found");
  const dir = "/var/run/secrets/kubernetes.io/serviceaccount/";
  const token = readFileSync(dir + "token", "utf8").trim(),
    ca = readFileSync(dir + "ca.crt");
  const path =
    "/apis/subresources.kubevirt.io/v1/namespaces/" +
    ns() +
    "/virtualmachineinstances/" +
    id +
    "/vnc/screenshot";
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "kubernetes.default.svc",
        port: 443,
        path,
        method: "GET",
        ca,
        headers: { authorization: "Bearer " + token, accept: "*/*" },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          // Keep upstream rejection details out of clients and logs; no credentials or guest bytes.
          res.resume();
          reject(new ApiError(502, "Screenshot upstream unavailable (" + res.statusCode + ")"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            req.destroy(new ApiError(502, "Screenshot exceeds size limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new ApiError(502, "Screenshot deadline exceeded")),
      20000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new ApiError(502, "Screenshot request timed out")));
    req.on("error", reject);
    req.end();
  });
}
