import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";
import type { EntourageNodeData } from "@/types";
import { cloneNodeForDuplicate } from "./canvasNodeClipboard";
import { createEntourageNodeData } from "./canvasNodeData";
import { buildManualGenerateNode } from "./canvasNodeCreation";

test("duplicating an entourage node preserves the rich feature", () => {
  const source = {
    id: "entourage-1",
    type: "entourageNode",
    position: { x: 10, y: 20 },
    data: createEntourageNodeData({ feature: "rich" }),
  } satisfies Node<EntourageNodeData>;

  const duplicate = cloneNodeForDuplicate(
    source,
    [source],
    () => "entourage-2",
  );

  assert.equal(duplicate?.type, "entourageNode");
  assert.equal(duplicate?.data.feature, "rich");
  assert.equal(duplicate?.data.sourceImageNodeId, null);
});

test("duplicating a GPT image node preserves background, with automatic background for older data", () => {
  const source = buildManualGenerateNode(
    "image-1",
    { x: 0, y: 0 },
    { width: 320, height: 240 },
  );
  assert.equal(source.data.background, "auto");
  source.data.background = "transparent";
  assert.equal(
    cloneNodeForDuplicate(source, [source], () => "image-2")?.data.background,
    "transparent",
  );
  delete source.data.background;
  assert.equal(
    cloneNodeForDuplicate(source, [source], () => "image-2")?.data.background,
    "auto",
  );
});

test("duplicating image generation keeps valid output counts and defaults older or invalid nodes to one", () => {
  for (const outputCount of [undefined, 1, 2, 4, 3, 5]) {
    const source = buildManualGenerateNode(
      "image-1",
      { x: 0, y: 0 },
      { width: 320, height: 240 },
    );
    assert.equal(source.data.outputCount, 1);
    source.data.outputCount = outputCount;
    const duplicate = cloneNodeForDuplicate(source, [source], () => "image-2");
    assert.equal(
      duplicate?.data.outputCount,
      outputCount === 2 || outputCount === 4 ? outputCount : 1,
    );
  }
});
