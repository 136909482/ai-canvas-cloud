import assert from "node:assert/strict";
import test from "node:test";
import { createEntourageNodeData } from "./canvasNodeData";

test("legacy entourage nodes default to automatic ratio and 1K", () => {
  const data = createEntourageNodeData();

  assert.equal(data.ratio, "Auto");
  assert.equal(data.resolution, "1K");
});

test("entourage output settings preserve supported values", () => {
  const supported = createEntourageNodeData({
    ratio: "16:9",
    resolution: "4K",
  });
  const invalid = createEntourageNodeData({
    ratio: "invalid",
    resolution: "8K",
  });

  assert.equal(supported.ratio, "16:9");
  assert.equal(supported.resolution, "4K");
  assert.equal(invalid.ratio, "Auto");
  assert.equal(invalid.resolution, "1K");
});

test("entourage feature normalization preserves rich and legacy values", () => {
  assert.equal(createEntourageNodeData().feature, "plants");
  assert.equal(createEntourageNodeData({ feature: "rich" }).feature, "rich");
  assert.equal(
    createEntourageNodeData({ feature: "people" }).feature,
    "people",
  );
  assert.equal(
    createEntourageNodeData({ feature: "unsupported" }).feature,
    "plants",
  );
});
