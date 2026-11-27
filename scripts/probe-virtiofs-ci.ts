/** Disposable infrastructure compatibility probe, never product/API evidence. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sha, sleep, writeJson } from "./api-client.ts";
const ns = "vm-virtiofs-probe",
  FEDORA = "quay.io/kubevirt/fedora-with-test-tooling-container-disk:v1.9.0",
  BUSYBOX = "docker.io/library/busybox:1.37.0";
function execute(args: string[], input?: string, timeout = 30, check = true) {
  const r = spawnSync(args[0], args.slice(1), {
    input,
    timeout: timeout * 1000,
    encoding: "utf8",
    maxBuffer: 4 * 1024 ** 2,
  });
  if (r.error) throw r.error;
  if (check && r.status !== 0) throw Error(args[0] + " failed: " + r.stderr.slice(-2000));
  return r;
}
const kube = (args: string[], input?: string, timeout = 30, check = true) =>
  execute(["kubectl", "-n", ns, ...args], input, timeout, check);
function apply(obj: unknown) {
  kube(["apply", "-f", "-"], JSON.stringify(obj));
}
function resolveImage(image: string) {
  const digest = execute(
    [
      "skopeo",
      "inspect",
      "--override-os",
      "linux",
      "--override-arch",
      "amd64",
      "--format",
      "{{.Digest}}",
      "docker://" + image,
    ],
    undefined,
    180,
  ).stdout.trim();
  assert(/^sha256:[0-9a-f]{64}$/.test(digest));
  return image.slice(0, image.lastIndexOf(":")) + "@" + digest;
}
export function verifyResponse(raw: string, challenge: string) {
  const pairs = raw
      .trim()
      .split(/\r?\n/)
      .map((x) => {
        const i = x.indexOf("=");
        assert(i > 0);
        return [x.slice(0, i), x.slice(i + 1)];
      }),
    result = Object.fromEntries(pairs);
  assert.equal(pairs.length, Object.keys(result).length);
  assert(
    result.sha256 === sha(Buffer.from(challenge, "ascii")) && result.filesystem === "virtiofs",
    "Guest did not return expected VirtioFS challenge",
  );
  assert(
    result.kernel && ["present", "unavailable"].includes(result.virtio_mem_driver),
    "Guest kernel evaluation missing",
  );
  return result;
}
export function objects(fedora: string, busybox: string) {
  const pvc = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: "exchange" },
    spec: {
      storageClassName: "local-path",
      accessModes: ["ReadWriteOnce"],
      volumeMode: "Filesystem",
      resources: { requests: { storage: "1Gi" } },
    },
  };
  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "reader" },
    spec: {
      automountServiceAccountToken: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 107,
        runAsGroup: 107,
        fsGroup: 107,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "reader",
          image: busybox,
          command: ["sleep", "1200"],
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
          resources: {
            requests: { cpu: "10m", memory: "16Mi" },
            limits: { cpu: "100m", memory: "64Mi" },
          },
          volumeMounts: [{ name: "exchange", mountPath: "/probe" }],
        },
      ],
      volumes: [{ name: "exchange", persistentVolumeClaim: { claimName: "exchange" } }],
    },
  };
  const userdata =
    '#!/bin/bash\nset -eu\nmkdir -p /mnt/probe\nmodprobe virtiofs || true\nmount -t virtiofs exchange /mnt/probe\ntest "$(findmnt -n -o FSTYPE /mnt/probe)" = virtiofs\nhash=$(sha256sum /mnt/probe/challenge | cut -d \' \' -f 1)\ndriver=unavailable\nif modprobe virtio_mem 2>/dev/null; then driver=present; fi\numask 077\nprintf \'sha256=%s\\nfilesystem=virtiofs\\nkernel=%s\\nvirtio_mem_driver=%s\\n\' "$hash" "$(uname -r)" "$driver" > /mnt/probe/response.tmp\nmv /mnt/probe/response.tmp /mnt/probe/response\nsync\n';
  const vmi = {
    apiVersion: "kubevirt.io/v1",
    kind: "VirtualMachineInstance",
    metadata: { name: "virtiofs-probe" },
    spec: {
      architecture: "amd64",
      nodeSelector: { "kubernetes.io/arch": "amd64" },
      domain: {
        cpu: { cores: 1 },
        resources: { requests: { memory: "1536Mi" } },
        devices: {
          autoattachPodInterface: false,
          rng: {},
          disks: [
            { name: "boot", disk: { bus: "virtio" } },
            { name: "cloudinit", disk: { bus: "virtio" } },
          ],
          filesystems: [{ name: "exchange", virtiofs: {} }],
        },
      },
      networks: [],
      volumes: [
        { name: "boot", containerDisk: { image: fedora } },
        { name: "cloudinit", cloudInitNoCloud: { userData: userdata } },
        { name: "exchange", persistentVolumeClaim: { claimName: "exchange" } },
      ],
    },
  };
  return [pvc, pod, vmi] as const;
}
async function main() {
  assert(process.env.GITHUB_ACTIONS === "true", "Run only in disposable hosted GitHub Actions");
  mkdirSync("evidence", { recursive: true });
  const result: Record<string, unknown> = {
    scope: "infrastructure-only",
    virtiofs: "not-verified",
    virtioMemLiveResize: "not-tested",
  };
  let created = false;
  try {
    const fedora = resolveImage(FEDORA),
      busybox = resolveImage(BUSYBOX);
    result.images = { fedora, reader: busybox, source: FEDORA, architecture: "amd64" };
    execute(["kubectl", "create", "namespace", ns]);
    created = true;
    const [pvc, pod, vmi] = objects(fedora, busybox);
    apply(pvc);
    apply(pod);
    kube(["wait", "pod/reader", "--for=condition=Ready", "--timeout=180s"], undefined, 200);
    const challenge = randomBytes(32).toString("hex");
    kube([
      "exec",
      "reader",
      "--",
      "sh",
      "-c",
      'umask 077; printf "%s" "$1" > /probe/challenge',
      "sh",
      challenge,
    ]);
    apply(vmi);
    kube(["wait", "vmi/virtiofs-probe", "--for=condition=Ready", "--timeout=420s"], undefined, 440);
    const end = performance.now() + 360000;
    let done = false;
    while (performance.now() < end) {
      const r = kube(["exec", "reader", "--", "cat", "/probe/response"], undefined, 30, false);
      if (r.status === 0) {
        Object.assign(result, verifyResponse(r.stdout, challenge));
        result.virtiofs = "guest-mount-and-byte-roundtrip-verified";
        done = true;
        break;
      }
      await sleep(5);
    }
    assert(done, "No guest-written response through VirtioFS");
    console.log(
      "Infrastructure VirtioFS guest mount/read/write verified; product file API not certified.",
    );
  } catch (e) {
    result.failureType = e instanceof Error ? e.name : "unknown";
    result.failure = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    writeJson("evidence/virtiofs-infrastructure.json", result);
    if (created) {
      for (const [name, args] of [
        ["virtiofs-resources.txt", ["get", "vmi,pod,pvc", "-o", "wide"]],
        ["virtiofs-events.txt", ["get", "events", "--sort-by=.lastTimestamp"]],
      ] as const) {
        const r = kube([...args], undefined, 30, false);
        writeFileSync("evidence/" + name, r.stdout + r.stderr);
      }
      execute(["kubectl", "delete", "namespace", ns, "--wait=false"], undefined, 30, false);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
