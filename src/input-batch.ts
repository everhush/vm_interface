import { z } from "zod";
import { ApiError } from "./kube";
export const batchSpec = z.strictObject({
  events: z
    .array(
      z.discriminatedUnion("type", [
        z.strictObject({
          type: z.literal("key"),
          keysym: z.number().int().min(0).max(0x1fffffff),
          down: z.boolean(),
        }),
        z.strictObject({
          type: z.literal("pointer"),
          x: z.number().int().min(0).max(1919),
          y: z.number().int().min(0).max(1199),
          buttons: z.number().int().min(0).max(255),
        }),
      ]),
    )
    .min(1)
    .max(64),
});
export type InputBatch = z.infer<typeof batchSpec>;
export function validateBatchGeometry(batch: InputBatch, width: number, height: number) {
  const keys = new Set<number>();
  for (const event of batch.events) {
    if (event.type === "pointer") {
      if (event.x >= width || event.y >= height) throw new ApiError(422, "Pointer outside display");
    } else if (event.down) {
      keys.add(event.keysym);
      if (keys.size > 32) throw new ApiError(422, "Too many simultaneous keys");
    } else keys.delete(event.keysym);
  }
}
export async function dispatchBatch(id: string, token: string, batch: InputBatch) {
  const r = await fetch("http://127.0.0.1:3444/input/" + id, {
    method: "POST",
    headers: { authorization: "Console " + token, "content-type": "application/json" },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(35000),
  });
  if (!r.ok) {
    const code = r.status;
    throw new ApiError(
      [400, 401, 403, 404, 409, 413, 422].includes(code) ? code : 502,
      "Console batch rejected (" + code + ")",
    );
  }
  const result = (await r.json()) as { accepted?: unknown; generation?: unknown };
  if (result.accepted !== batch.events.length || !Number.isInteger(result.generation))
    throw new ApiError(502, "Invalid console acknowledgement");
  return result;
}

export const INPUT_EVENT_DWELL_MS = 40;
export async function pacedInputBatch<T>(
  events: readonly T[],
  send: (event: T, index: number) => Promise<void>,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let i = 0; i < events.length; i++) {
    await send(events[i], i);
    await pause(INPUT_EVENT_DWELL_MS);
  }
}
