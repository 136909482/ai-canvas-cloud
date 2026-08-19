import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlanningImageSize } from "./planningImage";

test("planning image keeps small images at their original size", () => {
  assert.deepEqual(resolvePlanningImageSize(1200, 800), {
    width: 1200,
    height: 800,
  });
});

test("planning image bounds landscape and portrait images without distortion", () => {
  assert.deepEqual(resolvePlanningImageSize(5000, 2402), {
    width: 1536,
    height: 738,
  });
  assert.deepEqual(resolvePlanningImageSize(2402, 5000), {
    width: 738,
    height: 1536,
  });
});

test("planning image normalizes invalid dimensions", () => {
  assert.deepEqual(resolvePlanningImageSize(0, Number.NaN), {
    width: 1,
    height: 1,
  });
});
