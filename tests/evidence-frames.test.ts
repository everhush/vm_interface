import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  frameNumber,
  normalized,
  decodedFrame,
  verifyMarkerFrames,
  videoMarkerText,
} from "../scripts/evidence-frames.ts";
test("frame reference bounds", () => {
  assert.equal(frameNumber("frame-00001.png"), 0);
  assert.equal(frameNumber("frame-00240.png"), 239);
  for (const v of ["frame-00000.png", "frame-00241.png", "../frame-00001.png", "frame-1.png"])
    assert.throws(() => frameNumber(v));
  assert.equal(normalized("APKCOMPLETE arm64-v8a"), "apkcompletearm64v8a");
});
test("independently decode original pixels and order", () => {
  // Synthetic unit fixture only; never published as guest evidence.
  const folder = mkdtempSync(join(tmpdir(), "vm-frames-test-")),
    raw = join(folder, "fixture.mp4");
  try {
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:r=2:d=2",
        "-vf",
        "drawtext=text=scriptstart:fontcolor=white:fontsize=80:x=100:y=100:enable='lt(t,1)',drawtext=text=scriptdone:fontcolor=white:fontsize=80:x=100:y=100:enable='gte(t,1)'",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        raw,
      ],
      { timeout: 30000 },
    );
    const first = join(folder, "video-first-marker.png"),
      last = join(folder, "video-final-marker.png");
    decodedFrame(raw, 0, first);
    decodedFrame(raw, 2, last);
    const meta = {
      firstFrame: "frame-00001.png",
      finalFrame: "frame-00003.png",
      markers: { before: "scriptstart", after: "scriptdone" },
    };
    assert.equal(
      verifyMarkerFrames(raw, folder, meta, "control").independentlyDecodedMarkerFrames,
      true,
    );
    writeFileSync(last, readFileSync(first));
    assert.throws(() => verifyMarkerFrames(raw, folder, meta, "control"), /does not match/);
    assert.throws(
      () => verifyMarkerFrames(raw, folder, { ...meta, firstFrame: "frame-00004.png" }, "control"),
      /chronological/,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("functional marker review enlarges actual decoded pixels and retains exact ordering", () => {
  const folder = mkdtempSync(join(tmpdir(), "vm-functional-marker-")),
    raw = join(folder, "fixture.mp4");
  try {
    // Unit fixture only: small terminal-like lettering through lossy H.264.
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:r=2:d=2",
        "-vf",
        "drawtext=text=proofready:fontcolor=white:fontsize=16:x=64:y=80,drawtext=text=proofcomplete:fontcolor=white:fontsize=16:x=64:y=100:enable='gte(t,1)'",
        "-c:v",
        "libx264",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        raw,
      ],
      { timeout: 30000 },
    );
    const first = join(folder, "video-first-marker.png"),
      last = join(folder, "video-final-marker.png");
    decodedFrame(raw, 0, first);
    decodedFrame(raw, 2, last);
    assert(videoMarkerText(first, "functional").includes("proofready"));
    const meta = {
      firstFrame: "frame-00001.png",
      finalFrame: "frame-00003.png",
      markers: { before: "proofready", after: "proofcomplete" },
    };
    assert.equal(
      verifyMarkerFrames(raw, folder, meta, "functional").independentlyDecodedMarkerFrames,
      true,
    );
    assert.throws(
      () =>
        verifyMarkerFrames(
          raw,
          folder,
          { ...meta, markers: { before: "proofready", after: "proofconplete" } },
          "functional",
        ),
      /Incorrect functional markers/,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
