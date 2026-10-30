import assert from "node:assert/strict";
import test from "node:test";
import { getViewportMenuPosition } from "./viewportMenuPosition";

test("menus flip below when an upward-opening generation menu would be clipped", () => {
  assert.deepEqual(
    getViewportMenuPosition(
      { left: 600, top: 120, bottom: 156 },
      { width: 360, height: 520 },
      { width: 800, height: 800 },
      "top",
    ),
    { left: 428, top: 164, maxHeight: 624 },
  );
});

test("reference menus flip up near the bottom and fit horizontally on narrow screens", () => {
  assert.deepEqual(
    getViewportMenuPosition(
      { left: 250, top: 600, bottom: 628 },
      { width: 256, height: 224 },
      { width: 400, height: 700 },
      "bottom",
    ),
    { left: 132, top: 368, maxHeight: 580 },
  );
});

test("small windows use the roomier side and scroll the menu internally", () => {
  assert.deepEqual(
    getViewportMenuPosition(
      { left: 12, top: 120, bottom: 156 },
      { width: 296, height: 520 },
      { width: 320, height: 300 },
      "top",
    ),
    { left: 12, top: 164, maxHeight: 124 },
  );
});
