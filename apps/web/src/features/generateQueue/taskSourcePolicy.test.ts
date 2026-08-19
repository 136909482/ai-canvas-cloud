import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedTaskSourceNodeType } from "./taskSourcePolicy";

test("image tasks accept every image generation source node", () => {
  assert.equal(isSupportedTaskSourceNodeType("image", "generateNode"), true);
  assert.equal(isSupportedTaskSourceNodeType("image", "imageEditNode"), true);
  assert.equal(isSupportedTaskSourceNodeType("image", "entourageNode"), true);
  assert.equal(
    isSupportedTaskSourceNodeType("image", "videoGenerateNode"),
    false,
  );
});

test("video tasks accept only video generation nodes", () => {
  assert.equal(
    isSupportedTaskSourceNodeType("video", "videoGenerateNode"),
    true,
  );
  assert.equal(isSupportedTaskSourceNodeType("video", "entourageNode"), false);
  assert.equal(isSupportedTaskSourceNodeType("video", undefined), false);
});
