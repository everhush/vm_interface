import { test } from "node:test";
import assert from "node:assert/strict";
import { guestObservation } from "../src/guest";

test("guest observation is explicit when no VMI exists", () => {
  const result = guestObservation("vm-demo", null, "2026-11-24T00:00:00.000Z");
  assert.deepEqual(result, {
    id: "vm-demo",
    available: false,
    phase: null,
    ready: false,
    conditions: [],
    guestOS: null,
    interfaces: [],
    volumes: [],
    evidenceLevel: "kubevirt-status-only",
    console: { supported: false, reason: "A running VMI is required for console access." },
    observedAt: "2026-11-24T00:00:00.000Z",
  });
});

test("guest observation sanitizes KubeVirt status into stable evidence", () => {
  const result = guestObservation("vm-demo", {
    metadata: { uid: "secret-vmi" },
    status: {
      phase: "Running",
      conditions: [
        { type: "Ready", status: "True", reason: "GuestAgentConnected", message: "ignored" },
      ],
      guestOSInfo: {
        id: "cirros",
        name: "CirrOS",
        version: "0.6.2",
        kernelRelease: "6.1",
        password: "ignored",
      },
      interfaces: [
        {
          name: "default",
          interfaceName: "eth0",
          ipAddress: "192.0.2.10",
          mac: "52:54:00:00:00:01",
          secret: "ignored",
        },
      ],
      volumeStatus: [
        { name: "boot", phase: "Ready", target: "vda", reason: "", secret: "ignored" },
      ],
      privateField: "ignored",
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.phase, "Running");
  assert.equal(result.ready, true);
  assert.equal(result.console.supported, true);
  assert.equal(result.evidenceLevel, "kubevirt-status-only");
  assert.deepEqual(result.guestOS, {
    id: "cirros",
    name: "CirrOS",
    version: "0.6.2",
    kernelRelease: "6.1",
  });
  assert.deepEqual(result.interfaces, [
    { name: "default", interfaceName: "eth0", ipAddress: "192.0.2.10", mac: "52:54:00:00:00:01" },
  ]);
  assert.deepEqual(result.volumes, [{ name: "boot", phase: "Ready", target: "vda", reason: "" }]);
  assert.equal("privateField" in result, false);
});
