import assert from "node:assert/strict";
import test from "node:test";
import {
  CANVAS_CONNECTION_RADIUS,
  CANVAS_HANDLE_MAGNET_RADIUS,
  getCanvasHandleMagnetOffset,
  getCanvasHandleMagnetRegion,
  getCanvasHandleBorderPoint,
  getCanvasHandleSize,
  type CanvasHandleSide,
} from "./canvasHandleGeometry.ts";

test("lines reach the node border while retaining each handle's row or column", () => {
  const node = {
    internals: { positionAbsolute: { x: 100, y: 200 } },
    measured: { width: 280, height: 220 },
  };
  assert.deepEqual(
    getCanvasHandleBorderPoint({ x: 400, y: 310 }, "right", node),
    { x: 380, y: 310 },
  );
  assert.deepEqual(
    getCanvasHandleBorderPoint({ x: 80, y: 360 }, "left", node),
    { x: 100, y: 360 },
  );
  assert.deepEqual(
    getCanvasHandleBorderPoint({ x: 240, y: 180 }, "top", node),
    { x: 240, y: 200 },
  );
  assert.deepEqual(
    getCanvasHandleBorderPoint({ x: 240, y: 440 }, "bottom", node),
    { x: 240, y: 420 },
  );
  const resized = { ...node, measured: { width: 400, height: 300 } };
  assert.deepEqual(
    getCanvasHandleBorderPoint({ x: 520, y: 350 }, "right", resized),
    { x: 500, y: 350 },
  );
});

test("border anchors use absolute bounds and tolerate nodes pending measurement", () => {
  const point = { x: 150, y: 250 };
  const node = {
    internals: { positionAbsolute: { x: 30, y: 40 } },
    width: 100,
    height: 80,
  };
  assert.deepEqual(getCanvasHandleBorderPoint(point, "left", null), point);
  assert.deepEqual(
    getCanvasHandleBorderPoint(point, "left", { internals: node.internals }),
    point,
  );
  assert.deepEqual(getCanvasHandleBorderPoint(point, "right", node), {
    x: 130,
    y: 120,
  });
});

test("canvas handles keep a practical screen hit area while zooming out", () => {
  assert.equal(getCanvasHandleSize(1), 24);
  assert.equal(getCanvasHandleSize(0.8), 25);
  assert.equal(getCanvasHandleSize(0.5), 40);
  assert.equal(getCanvasHandleSize(0.35), 52);
  assert.equal(getCanvasHandleSize(0.05), 52);
});

test("magnetic handles follow the pointer within a circular range and reset outside it", () => {
  assert.deepEqual(getCanvasHandleMagnetOffset(0, 0, 1), { x: 0, y: 0 });
  assert.deepEqual(getCanvasHandleMagnetOffset(10, -10, 1), {
    x: 7.5,
    y: -7.5,
  });
  assert.ok(getCanvasHandleMagnetOffset(CANVAS_HANDLE_MAGNET_RADIUS, 0, 1));
  assert.ok(getCanvasHandleMagnetOffset(CANVAS_HANDLE_MAGNET_RADIUS * 2, 0, 1));
  assert.equal(
    getCanvasHandleMagnetOffset(CANVAS_HANDLE_MAGNET_RADIUS * 2 + 0.1, 0, 1),
    null,
  );
  assert.ok(getCanvasHandleMagnetOffset(48, 48, 1));
  assert.equal(getCanvasHandleMagnetOffset(10, 60, 1), null);
  assert.equal(getCanvasHandleMagnetOffset(-1, 0, 1), null);
  assert.deepEqual(getCanvasHandleMagnetOffset(10, 0, 1), { x: 7.5, y: 0 });
  assert.deepEqual(getCanvasHandleMagnetOffset(70, 0, 1), { x: 52.5, y: 0 });
});

test("magnetic offsets retain their screen direction and movement range at any zoom", () => {
  for (const zoom of [0.05, 0.35, 0.5, 0.8, 1, 2, 4]) {
    const offset = getCanvasHandleMagnetOffset(42, 56, zoom)!;
    const length = Math.hypot(offset.x, offset.y);
    assert.ok(offset.x > 0 && offset.y > 0);
    assert.ok(Math.abs(offset.x / offset.y - 0.75) < 0.0001);
    assert.ok(length * zoom <= 96.0001);
    assert.ok(Math.abs(length * zoom - 52.5) < 0.0001);
  }
  assert.deepEqual(getCanvasHandleMagnetOffset(10, 0, 0.5), { x: 15, y: 0 });
});

test("each handle follows inside an outward circle tangent to its fixed anchor", () => {
  const radius = CANVAS_HANDLE_MAGNET_RADIUS;
  const sides: CanvasHandleSide[] = ["right", "left", "top", "bottom"];
  for (const side of sides) {
    const region = getCanvasHandleMagnetRegion(side);
    assert.equal(Math.hypot(region.x, region.y), radius);
    const nx = region.x / radius;
    const ny = region.y / radius;
    assert.equal(getCanvasHandleMagnetOffset(-nx, -ny, 1, side), null);
    for (const zoom of [0.05, 0.5, 1, 4]) {
      for (let degrees = 0; degrees < 360; degrees += 15) {
        const angle = (degrees * Math.PI) / 180;
        const px = region.x + Math.cos(angle) * radius * 0.95;
        const py = region.y + Math.sin(angle) * radius * 0.95;
        const offset = getCanvasHandleMagnetOffset(px, py, zoom, side);
        assert.ok(offset);
        const x = offset.x * zoom;
        const y = offset.y * zoom;
        assert.ok(x * nx + y * ny >= -0.0001, `${side} stays outside the node`);
        assert.ok(Math.hypot(x - region.x, y - region.y) <= radius + 0.0001);
      }
    }
  }
});

test("magnetic offsets reject invalid pointer coordinates and safely fall back for invalid zoom", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(getCanvasHandleMagnetOffset(invalid, 0, 1), null);
    assert.equal(getCanvasHandleMagnetOffset(0, invalid, 1), null);
  }
  for (const zoom of [NaN, 0, -1, Infinity]) {
    assert.deepEqual(
      getCanvasHandleMagnetOffset(10, -5, zoom),
      getCanvasHandleMagnetOffset(10, -5, 1),
    );
  }
});

test("canvas handle sizing falls back safely while connection drops require direct hits", () => {
  assert.equal(getCanvasHandleSize(Number.NaN), 24);
  assert.equal(getCanvasHandleSize(0), 24);
  assert.equal(CANVAS_CONNECTION_RADIUS, 0);
});
