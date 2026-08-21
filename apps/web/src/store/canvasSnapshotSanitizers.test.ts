import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";
import {
  sanitizeNodeForHistory,
  sanitizeNodeForPersistence,
} from "./canvasSnapshotSanitizers.ts";

function createRefurnishNode(width: number, height: number): Node {
  return {
    id: "refurnish-size",
    type: "interiorRefurnishNode",
    position: { x: 0, y: 0 },
    width,
    height,
    selected: true,
    data: {},
  };
}

test("legacy default refurnish nodes migrate to the compact height", () => {
  const originalDefault = createRefurnishNode(420, 560);
  const interimDefault = createRefurnishNode(420, 480);

  assert.equal(sanitizeNodeForHistory(originalDefault).height, 440);
  assert.equal(sanitizeNodeForPersistence(originalDefault).height, 440);
  assert.equal(sanitizeNodeForHistory(interimDefault).height, 440);
  assert.equal(sanitizeNodeForPersistence(interimDefault).height, 440);
});

test("custom refurnish node dimensions remain unchanged", () => {
  const customHeight = createRefurnishNode(420, 640);
  const customWidth = createRefurnishNode(500, 560);

  assert.equal(sanitizeNodeForHistory(customHeight).height, 640);
  assert.equal(sanitizeNodeForPersistence(customHeight).height, 640);
  assert.equal(sanitizeNodeForHistory(customWidth).height, 560);
  assert.equal(sanitizeNodeForPersistence(customWidth).height, 560);
});
