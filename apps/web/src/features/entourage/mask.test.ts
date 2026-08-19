import assert from "node:assert/strict";
import test from "node:test";
import type { EntouragePlacement } from "@/types";
import { buildPlacementRects, drawPlacementMask } from "./mask";

function placement(
  kind: string,
  box: [number, number, number, number],
): EntouragePlacement {
  return { id: kind, kind, label: kind, box, prompt: "p" };
}

test("converts normalized boxes to pixel rects", () => {
  const rects = buildPlacementRects(
    [placement("tree", [0.1, 0.5, 0.3, 0.9])],
    1000,
    800,
  );
  assert.deepEqual(rects, [{ x: 100, y: 400, width: 200, height: 320 }]);
});

test("keeps a minimum rect size and clamps inside the image", () => {
  const rects = buildPlacementRects(
    [placement("tiny", [0.99, 0.99, 0.999, 0.999])],
    100,
    100,
  );
  const rect = rects[0];
  assert.ok(rect);
  assert.ok(rect.width >= 8);
  assert.ok(rect.height >= 8);
  assert.ok(rect.x + rect.width <= 100);
  assert.ok(rect.y + rect.height <= 100);
});

test("keeps the source opaque and clears only placement rectangles", () => {
  const fillCalls: Array<[number, number, number, number]> = [];
  const clearCalls: Array<[number, number, number, number]> = [];
  const context = {
    clearRect: (x: number, y: number, width: number, height: number) => {
      clearCalls.push([x, y, width, height]);
    },
    fillStyle: "",
    fillRect: (x: number, y: number, width: number, height: number) => {
      fillCalls.push([x, y, width, height]);
    },
  };
  const canvas = {
    width: 100,
    height: 80,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;

  drawPlacementMask(canvas, [{ x: 1, y: 2, width: 10, height: 20 }]);
  assert.deepEqual(fillCalls, [[0, 0, 100, 80]]);
  assert.deepEqual(clearCalls, [
    [0, 0, 100, 80],
    [1, 2, 10, 20],
  ]);
  assert.equal(context.fillStyle, "#ffffff");
});

test("silently skips drawing when the 2d context is unavailable", () => {
  const canvas = {
    width: 320,
    height: 240,
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
  drawPlacementMask(canvas, [{ x: 0, y: 0, width: 10, height: 10 }]);
  assert.equal(canvas.width, 320);
  assert.equal(canvas.height, 240);
});
