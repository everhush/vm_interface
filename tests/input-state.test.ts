import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { HeldInput } from "../src/input-state";
test("ownership generation changes release held keys and buttons before new input", () => {
  const sent: unknown[] = [];
  const sink = {
    keyEvent: (key: number, down: boolean) => sent.push(["key", key, down]),
    pointerEvent: (x: number, y: number, buttons: number) => sent.push(["pointer", x, y, buttons]),
  };
  const state = new HeldInput();
  state.select(sink, { ticketId: "a", generation: 1, token: "secret-a" });
  assert.equal(state.key(sink, 65, true), true);
  assert.equal(state.pointer(sink, 2, 3, 1, 640, 480), true);
  state.select(sink, { ticketId: "b", generation: 2, token: "secret-b" });
  assert.deepEqual(sent, [
    ["key", 65, true],
    ["pointer", 2, 3, 1],
    ["key", 65, false],
    ["pointer", 2, 3, 0],
  ]);
  assert.equal(state.pointer(sink, 640, 0, 1, 640, 480), false);
  assert.equal(state.key(sink, -1, true), false);
  state.key(sink, 66, true);
  state.release(sink);
  assert.deepEqual(sent.at(-1), ["key", 66, false]);
  assert.equal(state.owner, null);
});
