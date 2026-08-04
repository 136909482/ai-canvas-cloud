import assert from "node:assert/strict";
import test from "node:test";
import {
  CANVAS_CONNECTION_RADIUS,
  getCanvasHandleSize,
} from "./canvasHandleGeometry.ts";

test("canvas handles keep a practical screen hit area while zooming out", () => {
  assert.equal(getCanvasHandleSize(1), 24);
  assert.equal(getCanvasHandleSize(0.8), 25);
  assert.equal(getCanvasHandleSize(0.5), 40);
  assert.equal(getCanvasHandleSize(0.35), 52);
  assert.equal(getCanvasHandleSize(0.05), 52);
});

test("canvas handle sizing falls back safely and increases drop tolerance", () => {
  assert.equal(getCanvasHandleSize(Number.NaN), 24);
  assert.equal(getCanvasHandleSize(0), 24);
  assert.equal(CANVAS_CONNECTION_RADIUS, 32);
});
