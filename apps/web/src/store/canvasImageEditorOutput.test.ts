import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import type { GeneratedPreviewNodeDraft } from "./canvasNodeCreation";
import { buildImageEditorOutputState } from "./canvasImageEditorOutput";

const preview: GeneratedPreviewNodeDraft = {
  label: "edited image",
  imageUrl: "data:image/png;base64,edited",
  imageAsset: null,
  prompt: "",
  model: "manual-edit",
  ratio: "Auto",
  status: "done",
  errorMsg: "",
  imageWidth: 1024,
  imageHeight: 768,
  sourceImageNodeId: "image-source",
  originOperation: "image-edit",
  taskId: null,
};

function makeSourceNode(id: string, type: string): Node {
  return {
    id,
    type,
    position: { x: 120, y: 80 },
    width: 320,
    height: 240,
    data: {},
  };
}

test("image editor creates a preview node beside an image source", () => {
  const sourceNode = makeSourceNode("image-source", "imageNode");
  const result = buildImageEditorOutputState({
    nodes: [sourceNode],
    edges: [],
    sourceNodeId: sourceNode.id,
    preview,
    nextPreviewId: () => "preview-edited",
  });

  assert.ok(result);
  assert.equal(result.createdNodeId, "preview-edited");
  assert.equal(result.edges.length, 1);
  assert.deepEqual(result.edges[0], {
    id: "edge-image-source-preview-edited",
    source: "image-source",
    target: "preview-edited",
    animated: true,
  } satisfies Edge);

  const outputNode = result.nodes.find((node) => node.id === "preview-edited");
  assert.equal(outputNode?.type, "generatedPreviewNode");
  assert.equal(outputNode?.data.sourceGenerateNodeId, "image-source");
  assert.equal(outputNode?.data.sourceImageNodeId, "image-source");
  assert.equal(outputNode?.data.originOperation, "image-edit");
  assert.equal(outputNode?.width, 300);
  assert.equal(outputNode?.height, 228);
  assert.ok((outputNode?.position.x ?? 0) > sourceNode.position.x);
});

test("image editor creates another preview from a generated preview source", () => {
  const sourceNode = makeSourceNode("existing-preview", "generatedPreviewNode");
  const result = buildImageEditorOutputState({
    nodes: [sourceNode],
    edges: [],
    sourceNodeId: sourceNode.id,
    preview: {
      ...preview,
      sourceImageNodeId: "original-image",
    },
    nextPreviewId: () => "nested-preview",
  });

  assert.ok(result);
  const outputNode = result.nodes.find((node) => node.id === "nested-preview");
  assert.equal(outputNode?.data.sourceGenerateNodeId, "existing-preview");
  assert.equal(outputNode?.data.sourceImageNodeId, "original-image");
});

test("image editor rejects unsupported or missing source nodes", () => {
  let requestedPreviewId = false;
  const result = buildImageEditorOutputState({
    nodes: [makeSourceNode("text-source", "textNode")],
    edges: [],
    sourceNodeId: "text-source",
    preview,
    nextPreviewId: () => {
      requestedPreviewId = true;
      return "should-not-be-created";
    },
  });

  assert.equal(result, null);
  assert.equal(requestedPreviewId, false);
});
