import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForEmptyExchange } from "../scripts/api-client.ts";

const path = "/computers/vm-test";
const reply = (status: number, body: unknown) => ({
  status,
  data: Buffer.from(JSON.stringify(body)),
  headers: new Headers(),
});

test("exchange readiness retries only explicit broker startup conflicts", async () => {
  let calls = 0;
  await waitForEmptyExchange(async (method, target, options) => {
    assert.equal(method, "GET");
    assert.equal(target, path + "/files");
    assert.deepEqual(options?.expected, [200, 409]);
    calls++;
    return calls === 1 ? reply(409, { error: "Exchange broker not ready; retry" })
      : calls === 2 ? reply(409, { error: "Exchange broker not ready" }) : reply(200, []);
  }, path, 2, 0);
  assert.equal(calls, 3);
});

test("exchange readiness rejects unexpected conflicts and existing guest output", async () => {
  let calls = 0;
  await assert.rejects(waitForEmptyExchange(async () => {
    calls++;
    return reply(409, { error: "Exchange resource ownership not confirmed" });
  }, path, 2, 0), /Unexpected exchange conflict/);
  assert.equal(calls, 1);
  await assert.rejects(waitForEmptyExchange(async () => reply(200, [{ name: "result.bin" }]), path, 2, 0),
    /Fresh exchange already contains guest output/);
});

test("exchange readiness has a bounded deadline", async () => {
  await assert.rejects(waitForEmptyExchange(async () => reply(409, { error: "Exchange broker not ready" }), path, 0.03, 0),
    /Exchange broker did not become ready/);
});
