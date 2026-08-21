import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import { enqueueInteriorRefurnishTask } from "@/features/generateQueue/orchestrator.ts";
import { canvasNodeRegistrations } from "@/features/nodeRegistry/protocol.ts";
import { useCanvasStore } from "@/store/useCanvasStore.ts";
import { useTaskQueueStore } from "@/store/useTaskQueueStore.ts";

function build(type: "imageNode" | "interiorRefurnishNode", id: string) {
  const registration = canvasNodeRegistrations[type].manual!;
  return registration.build(id, { x: 0, y: 0 }, registration.size);
}

function image(id: string) {
  const node = build("imageNode", id);
  node.data.imageUrl = `data:image/png;base64,${id}`;
  return node;
}

function reset(nodes: Node[], edges: Edge[] = []) {
  useCanvasStore.setState({ nodes, edges, copiedNode: null });
  useTaskQueueStore.getState().resetToEmpty();
}

test("connections derive one scene and an ordered four-product list", () => {
  const refurnish = build("interiorRefurnishNode", "refurnish-1");
  const sceneA = image("scene-a");
  const sceneB = image("scene-b");
  const products = Array.from({ length: 5 }, (_, index) =>
    image(`product-${index + 1}`),
  );
  reset([refurnish, sceneA, sceneB, ...products]);

  useCanvasStore.getState().onConnect({
    source: sceneA.id,
    sourceHandle: "output",
    target: refurnish.id,
    targetHandle: "scene",
  });
  for (const product of products) {
    useCanvasStore.getState().onConnect({
      source: product.id,
      sourceHandle: "output",
      target: refurnish.id,
      targetHandle: "product",
    });
  }
  let data = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === refurnish.id)!.data;
  assert.equal(data.sceneSourceNodeId, sceneA.id);
  assert.deepEqual(
    data.productSourceOrder,
    products.slice(0, 4).map((node) => node.id),
  );

  useCanvasStore.getState().updateNodeData(refurnish.id, {
    recognizedParts: ["沙发"],
    bindings: [{ sourceNodeId: products[0]!.id, partName: "沙发" }],
  });
  useCanvasStore.getState().onConnect({
    source: sceneB.id,
    sourceHandle: "output",
    target: refurnish.id,
    targetHandle: "scene",
  });
  data = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === refurnish.id)!.data;
  assert.equal(data.sceneSourceNodeId, sceneB.id);
  assert.deepEqual(data.recognizedParts, []);
  assert.deepEqual(data.bindings, []);
});

test("disconnecting a product removes only its binding", () => {
  const refurnish = build("interiorRefurnishNode", "refurnish-1");
  const first = image("product-1");
  const second = image("product-2");
  reset([refurnish, first, second]);
  useCanvasStore.getState().onConnect({
    source: first.id,
    sourceHandle: "output",
    target: refurnish.id,
    targetHandle: "product",
  });
  useCanvasStore.getState().onConnect({
    source: second.id,
    sourceHandle: "output",
    target: refurnish.id,
    targetHandle: "product",
  });
  useCanvasStore.getState().updateNodeData(refurnish.id, {
    bindings: [
      { sourceNodeId: first.id, partName: "沙发" },
      { sourceNodeId: second.id, partName: "茶几" },
    ],
  });
  const edge = useCanvasStore
    .getState()
    .edges.find((item) => item.source === first.id)!;
  useCanvasStore.getState().deleteEdge(edge.id);
  const data = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === refurnish.id)!.data;
  assert.deepEqual(data.productSourceOrder, [second.id]);
  assert.deepEqual(data.bindings, [
    { sourceNodeId: second.id, partName: "茶几" },
  ]);
});

test("specialized task keeps scene first and creates a standard preview", () => {
  const refurnish = build("interiorRefurnishNode", "refurnish-1");
  reset([refurnish]);
  const references = [
    { sourceNodeId: "scene", imageUrl: "data:scene", assetRelativePath: null },
    { sourceNodeId: "sofa", imageUrl: "data:sofa", assetRelativePath: null },
  ];
  const taskId = enqueueInteriorRefurnishTask({
    nodeId: refurnish.id,
    prompt: "replace sofa",
    model: "model-1",
    sourceImageNodeId: "scene",
    referenceImages: references,
  });
  assert.ok(taskId);
  const task = useTaskQueueStore.getState().tasks[0]!;
  assert.deepEqual(task.referenceImages, references);
  assert.equal(task.ratio, "Auto");
  assert.equal(
    useCanvasStore
      .getState()
      .nodes.find((node) => node.id === task.previewNodeId)?.type,
    "generatedPreviewNode",
  );
});
