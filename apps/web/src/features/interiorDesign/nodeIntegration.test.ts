import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";
import { canvasNodeRegistrations } from "@/features/nodeRegistry/protocol.ts";
import { enqueueGenerateTask } from "@/features/generateQueue/orchestrator.ts";
import { cloneNodeForDuplicate } from "@/store/canvasNodeClipboard.ts";
import { useCanvasStore } from "@/store/useCanvasStore.ts";
import { useTaskQueueStore } from "@/store/useTaskQueueStore.ts";

function createImageNode(id: string): Node {
  return {
    id,
    type: "imageNode",
    position: { x: 0, y: 0 },
    data: {
      imageUrl: `blob:${id}`,
      imageAsset: null,
      status: "idle",
    },
  };
}

function createInteriorNode() {
  const registration = canvasNodeRegistrations.interiorDesignNode.manual!;
  return registration.build("interior-1", { x: 300, y: 0 }, registration.size);
}

test("interior design input accepts one image and a new connection replaces it", () => {
  const first = createImageNode("image-1");
  const second = createImageNode("image-2");
  const interior = createInteriorNode();
  useCanvasStore.setState({ nodes: [first, second, interior], edges: [] });

  useCanvasStore.getState().onConnect({
    source: first.id,
    sourceHandle: null,
    target: interior.id,
    targetHandle: "image",
  });
  useCanvasStore.getState().onConnect({
    source: second.id,
    sourceHandle: null,
    target: interior.id,
    targetHandle: "image",
  });

  const state = useCanvasStore.getState();
  assert.equal(state.edges.length, 1);
  assert.equal(state.edges[0]?.source, second.id);
  assert.equal(
    state.nodes.find((node) => node.id === interior.id)?.data.sourceImageNodeId,
    second.id,
  );

  state.deleteEdge(state.edges[0]!.id);
  assert.equal(
    useCanvasStore.getState().nodes.find((node) => node.id === interior.id)
      ?.data.sourceImageNodeId,
    null,
  );
});

test("duplicating an interior node keeps configuration but resets input and runtime", () => {
  const interior = createInteriorNode();
  interior.data.sourceImageNodeId = "image-1";
  interior.data.status = "generating";
  interior.data.activeTaskId = "task-1";
  interior.data.errorMsg = "stale";

  const clone = cloneNodeForDuplicate(interior, [interior], () => "interior-2");
  assert.ok(clone);
  assert.deepEqual(clone.data.config, interior.data.config);
  assert.notEqual(clone.data.config, interior.data.config);
  assert.equal(clone.data.sourceImageNodeId, null);
  assert.equal(clone.data.status, "idle");
  assert.equal(clone.data.activeTaskId, null);
  assert.equal(clone.data.errorMsg, "");
});

test("enqueue freezes compiled JSON, one image, model, ratio and resolution", () => {
  const image = createImageNode("image-1");
  const interior = createInteriorNode();
  useCanvasStore.setState({ nodes: [image, interior], edges: [] });
  useTaskQueueStore.getState().resetToEmpty();

  const frozenPrompt = '{"图生图任务指令":{"任务":"室内设计"}}';
  const taskId = enqueueGenerateTask({
    projectId: "project-1",
    sourceNodeId: interior.id,
    prompt: frozenPrompt,
    model: "image-model-1",
    ratio: "Auto",
    resolution: "2K",
    operationType: "image-to-image",
    referenceImages: [
      {
        sourceNodeId: image.id,
        imageUrl: image.data.imageUrl as string,
        assetRelativePath: "images/source.png",
      },
    ],
  });

  assert.ok(taskId);
  useCanvasStore.getState().updateNodeData(interior.id, {
    compiledPrompt: "changed after enqueue",
    ratio: "16:9",
    resolution: "4K",
  });
  const task = useTaskQueueStore
    .getState()
    .tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task);
  assert.equal(task.prompt, frozenPrompt);
  assert.equal(task.operationType, "image-to-image");
  assert.equal(task.model, "image-model-1");
  assert.equal(task.ratio, "Auto");
  assert.equal(task.resolution, "2K");
  assert.deepEqual(task.referenceImages, [
    {
      sourceNodeId: image.id,
      imageUrl: "blob:image-1",
      assetRelativePath: "images/source.png",
    },
  ]);
  const preview = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === task.previewNodeId);
  assert.equal(preview?.type, "generatedPreviewNode");
  assert.equal(preview?.data.sourceGenerateNodeId, interior.id);
});
