import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";
import type { EntourageNodeData } from "@/types";
import { cloneNodeForDuplicate } from "./canvasNodeClipboard";
import { createEntourageNodeData } from "./canvasNodeData";

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
