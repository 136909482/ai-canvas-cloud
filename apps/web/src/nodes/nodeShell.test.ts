import assert from "node:assert/strict";
import test from "node:test";
import {
  getNodeHeaderClassName,
  getNodeHeaderScale,
} from "./nodeHeaderStyles.ts";

test("node header keeps embedded styling by default", () => {
  const className = getNodeHeaderClassName("embedded");

  assert.match(className, /node-drag-handle/);
  assert.match(className, /border-b/);
  assert.doesNotMatch(className, /absolute -top-6/);
});

test("floating node header renders above the shell as a drag handle", () => {
  const className = getNodeHeaderClassName("floating");

  assert.match(className, /node-drag-handle/);
  assert.match(className, /absolute -top-6/);
  assert.match(className, /max-w-\[220px\]/);
  assert.doesNotMatch(className, /border-b/);
});

test("floating node header scales back up as the canvas zooms out", () => {
  assert.equal(getNodeHeaderScale(1), 1);
  assert.equal(getNodeHeaderScale(0.5), 2);
  assert.equal(getNodeHeaderScale(0.2), 5);
  assert.equal(getNodeHeaderScale(0.05), 6);
  assert.equal(getNodeHeaderScale(Number.NaN), 1);
});
