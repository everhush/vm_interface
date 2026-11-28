import { test } from "node:test";
import assert from "node:assert/strict";
import { activeClaim, mayAcquire } from "../src/input-lease";
test("only a human may take over a live automation lease", () => {
  const now = 1000,
    current = {
      ticketId: "a",
      actor: "automation",
      instanceUid: "i",
      expiresAt: new Date(now + 100),
    };
  const automation = { ticketId: "b", actor: "automation", instanceUid: "i" },
    human = { ...automation, actor: "human" };
  assert.equal(mayAcquire(current, automation, true, now), false);
  assert.equal(mayAcquire(current, human, false, now), false);
  assert.equal(mayAcquire(current, human, true, now), true);
  assert.equal(mayAcquire({ ...current, actor: "human" }, human, true, now), false);
  assert.equal(mayAcquire(current, { ...automation, ticketId: "a" }, false, now), true);
  assert.equal(mayAcquire(current, automation, false, now + 100), true);
  assert.equal(mayAcquire(current, { ...automation, instanceUid: "new" }, false, now), true);
  assert.equal(activeClaim(current, now + 100), false);
});
