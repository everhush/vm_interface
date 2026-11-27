import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { apiKeyToken, keySpec, keyUsable, requirePermission } from "../src/account-keys";
test("key spec and credential separation", () => {
  const token = "vmk_" + "a".repeat(43);
  assert.equal(apiKeyToken("Bearer " + token), token);
  assert.equal(apiKeyToken("Console " + token), null);
  assert.equal(apiKeyToken("Bearer " + token + "="), null);
  assert.equal(
    keySpec.safeParse({ label: "test", permission: "admin", ttlSeconds: 60 }).success,
    false,
  );
  assert.equal(
    keySpec.safeParse({ label: "test", permission: "read", ttlSeconds: 59 }).success,
    false,
  );
});
test("expiry, revocation and read-only permission are enforced", () => {
  const now = Date.now(),
    row = { expiresAt: new Date(now + 1), revokedAt: null, permission: "read" };
  assert.equal(keyUsable(row, now), true);
  assert.equal(keyUsable(row, now + 1), false);
  assert.equal(keyUsable({ ...row, revokedAt: new Date(now) }, now), false);
  const identity = {
    account: "alpha",
    kind: "account-key" as const,
    permission: "read" as const,
    keyId: "id",
  };
  assert.doesNotThrow(() => requirePermission(identity, "GET"));
  assert.throws(() => requirePermission(identity, "POST"), { status: 403 });
  assert.throws(() => requirePermission(identity, "GET", true), { status: 403 });
  assert.throws(() => requirePermission({ ...identity, permission: "manage" }, "POST", true), {
    status: 403,
  });
});
