import assert from "node:assert/strict";
import test from "node:test";
import { buildDownloadFileName } from "./downloadFileName";

const FIXED_TIMESTAMP = new Date(2026, 7, 17, 14, 30, 5).getTime();

test("builds ai_canvas timestamp name", () => {
  assert.equal(
    buildDownloadFileName({
      extension: "png",
      timestamp: FIXED_TIMESTAMP,
    }),
    "ai_canvas-20260817-143005.png",
  );
});

test("pads month, day, hours, minutes and seconds to two digits", () => {
  const timestamp = new Date(2026, 0, 3, 9, 7, 9).getTime();
  assert.equal(
    buildDownloadFileName({
      extension: "mp4",
      timestamp,
    }),
    "ai_canvas-20260103-090709.mp4",
  );
});

test("appends the suffix between prefix and timestamp", () => {
  assert.equal(
    buildDownloadFileName({
      suffix: "-mask",
      extension: "png",
      timestamp: FIXED_TIMESTAMP,
    }),
    "ai_canvas-mask-20260817-143005.png",
  );
  assert.equal(
    buildDownloadFileName({
      suffix: "-edit",
      extension: "png",
      timestamp: FIXED_TIMESTAMP,
    }),
    "ai_canvas-edit-20260817-143005.png",
  );
});

test("normalizes the extension", () => {
  assert.equal(
    buildDownloadFileName({
      extension: ".MP4",
      timestamp: FIXED_TIMESTAMP,
    }),
    "ai_canvas-20260817-143005.mp4",
  );
});
