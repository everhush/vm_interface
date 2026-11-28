import { test } from "node:test";
import assert from "node:assert/strict";
import { exposureSpec, networkToken, privateNetwork, validNetworkGrant } from "../src/network";
import { computerSpec, vmManifest } from "../src/spec";
test("private networking is explicit; no public service profile", () => {
  const spec = computerSpec.parse({
    version: 1,
    name: "net",
    architecture: "amd64",
    cpu: 1,
    memoryMiB: 512,
    image: "cirros-smoke",
  });
  assert.equal(privateNetwork(vmManifest("vm-x", "alpha", spec)), false);
  assert.equal(privateNetwork(vmManifest("vm-x", "alpha", { ...spec, network: "private" })), true);
  assert.equal(exposureSpec.safeParse({ port: 80, access: "public" }).success, false);
  assert.equal(exposureSpec.safeParse({ port: 65536, access: "private-tunnel" }).success, false);
  assert.equal(
    exposureSpec.safeParse({ port: 80, ttlSeconds: 601, access: "private-tunnel" }).success,
    false,
  );
});
test("network token and grant cannot cross VM or scope", () => {
  const t = "a".repeat(43),
    now = 1000;
  assert.equal(networkToken("Network " + t), t);
  assert.equal(networkToken(null, ["binary", "vm-network." + t]), t);
  assert.equal(networkToken("Console " + t), null);
  assert.equal(networkToken("Network " + t, ["vm-network." + "b".repeat(43)]), null);
  const g = { id: "one", computerId: "vm-a", expiresAt: new Date(now + 10), revokedAt: null };
  assert.equal(validNetworkGrant(g, "one", "vm-a", now), true);
  assert.equal(validNetworkGrant(g, "one", "vm-b", now), false);
  assert.equal(validNetworkGrant(g, "one", "vm-a", now + 10), false);
  assert.equal(validNetworkGrant({ ...g, revokedAt: new Date(now) }, "one", "vm-a", now), false);
});
