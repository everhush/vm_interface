import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { validateVideoProbe } from "../src/recording-worker";
test("only bounded playable video-only H264 metadata is accepted", () => {
  const valid = {
    format: { duration: "2.5", size: "1000" },
    streams: [{ codec_type: "video", codec_name: "h264" }],
  };
  assert.equal(validateVideoProbe(valid, 1000), 2500);
  assert.throws(() => validateVideoProbe(valid, 999), /Invalid/);
  assert.throws(
    () =>
      validateVideoProbe({ ...valid, streams: [...valid.streams, { codec_type: "audio" }] }, 1000),
    /Invalid/,
  );
  assert.throws(
    () => validateVideoProbe({ ...valid, format: { duration: "0", size: "1000" } }, 1000),
    /Invalid/,
  );
});
