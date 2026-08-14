import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import { canvasNodeRegistrations } from "@/features/nodeRegistry/protocol.ts";
import { compileInteriorDesignPrompt } from "@/features/interiorDesign/compiler.ts";
import { enqueueGenerateTask } from "@/features/generateQueue/orchestrator.ts";
import { cloneNodeForDuplicate } from "@/store/canvasNodeClipboard.ts";
import { useCanvasStore } from "@/store/useCanvasStore.ts";
import { useHistoryStore } from "@/store/useHistoryStore.ts";
import { useTaskQueueStore } from "@/store/useTaskQueueStore.ts";
import type { InteriorDesignNodeData } from "@/types/index.ts";

function createInteriorNode(id = "interior-1"): Node<InteriorDesignNodeData> {
  const registration = canvasNodeRegistrations.interiorDesignNode.manual!;
  return registration.build(
    id,
    { x: 300, y: 0 },
    registration.size,
  ) as Node<InteriorDesignNodeData>;
}

function resetCanvas(nodes: Node[], edges: Edge[] = []) {
  useCanvasStore.setState({ nodes, edges, copiedNode: null });
  useHistoryStore.getState().clearHistory();
  useTaskQueueStore.getState().resetToEmpty();
}

test("interior design materializes and reuses one editable text output", () => {
  const interior = createInteriorNode();
  resetCanvas([interior]);

  const firstOutputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(interior.id);
  const firstState = useCanvasStore.getState();
  const outputNode = firstState.nodes.find(
    (node) => node.id === firstOutputId && node.type === "textNode",
  );

  assert.ok(outputNode);
  assert.equal(outputNode.selected, true);
  assert.equal(outputNode.data.label, "室内设计 JSON 提示词");
  assert.equal(outputNode.data.text, interior.data.compiledPrompt);
  assert.equal(firstState.edges.length, 1);
  assert.deepEqual(firstState.edges[0], {
    id: `edge-${interior.id}-${firstOutputId}`,
    source: interior.id,
    sourceHandle: "prompt",
    target: firstOutputId,
    targetHandle: "input",
    animated: true,
  });

  useCanvasStore.getState().updateNodeData(firstOutputId, { text: "手工修改" });
  const secondOutputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(interior.id);
  const secondState = useCanvasStore.getState();

  assert.equal(secondOutputId, firstOutputId);
  assert.equal(secondState.nodes.length, 2);
  assert.equal(secondState.edges.length, 1);
  assert.equal(
    secondState.nodes.find((node) => node.id === firstOutputId)?.selected,
    true,
  );
  assert.equal(
    secondState.nodes.find((node) => node.id === firstOutputId)?.data.text,
    interior.data.compiledPrompt,
  );
});

test("changing interior parameters overwrites the linked text atomically", () => {
  const interior = createInteriorNode();
  resetCanvas([interior]);
  const outputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(interior.id);
  useCanvasStore.getState().updateNodeData(outputId, { text: "手工修改" });

  const nextConfig = structuredClone(interior.data.config);
  nextConfig.customRequirement = "增加一张深绿色单椅";
  useCanvasStore.getState().updateInteriorDesignConfig(interior.id, nextConfig);

  const state = useCanvasStore.getState();
  const expectedPrompt = compileInteriorDesignPrompt(nextConfig);
  assert.equal(
    state.nodes.find((node) => node.id === interior.id)?.data.compiledPrompt,
    expectedPrompt,
  );
  assert.equal(
    state.nodes.find((node) => node.id === outputId)?.data.text,
    expectedPrompt,
  );
});

test("deleting the output edge stops synchronization and preserves text", () => {
  const interior = createInteriorNode();
  resetCanvas([interior]);
  const outputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(interior.id);
  const edgeId = useCanvasStore.getState().edges[0]!.id;

  useCanvasStore.getState().deleteEdge(edgeId);
  useCanvasStore.getState().updateNodeData(outputId, { text: "独立文本" });
  const nextConfig = structuredClone(interior.data.config);
  nextConfig.customRequirement = "不会覆盖独立文本";
  useCanvasStore.getState().updateInteriorDesignConfig(interior.id, nextConfig);

  const state = useCanvasStore.getState();
  assert.equal(
    state.nodes.find((node) => node.id === interior.id)?.data.outputTextNodeId,
    null,
  );
  assert.equal(
    state.nodes.find((node) => node.id === outputId)?.data.text,
    "独立文本",
  );
});

test("deleting either side keeps the remaining prompt content safe", () => {
  const interior = createInteriorNode();
  resetCanvas([interior]);
  const outputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(interior.id);

  useCanvasStore.getState().deleteNode(interior.id);
  assert.equal(
    useCanvasStore.getState().nodes.find((node) => node.id === outputId)?.data
      .text,
    interior.data.compiledPrompt,
  );

  const secondInterior = createInteriorNode("interior-2");
  resetCanvas([secondInterior]);
  const secondOutputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(secondInterior.id);
  useCanvasStore.getState().deleteNode(secondOutputId);
  assert.equal(
    useCanvasStore
      .getState()
      .nodes.find((node) => node.id === secondInterior.id)?.data
      .outputTextNodeId,
    null,
  );

  const recreatedOutputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(secondInterior.id);
  assert.notEqual(recreatedOutputId, secondOutputId);
  assert.equal(useCanvasStore.getState().nodes.length, 2);
  assert.equal(useCanvasStore.getState().edges.length, 1);
});

test("interior prompt can drive AI drawing directly without creating tasks", () => {
  const interior = createInteriorNode();
  const generateRegistration = canvasNodeRegistrations.generateNode.manual!;
  const generate = generateRegistration.build(
    "gen-2",
    { x: 980, y: 0 },
    generateRegistration.size,
  );
  resetCanvas([interior, generate]);

  useCanvasStore.getState().onConnect({
    source: interior.id,
    sourceHandle: "prompt",
    target: generate.id,
    targetHandle: "prompt",
  });

  const connectedGenerate = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === generate.id);
  assert.equal(connectedGenerate?.data.connectedTextNode, interior.id);
  assert.equal(connectedGenerate?.data.prompt, interior.data.compiledPrompt);

  const outputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(interior.id);
  useCanvasStore.getState().onConnect({
    source: outputId,
    sourceHandle: "output",
    target: generate.id,
    targetHandle: "prompt",
  });
  const textConnectedGenerate = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === generate.id);
  assert.equal(textConnectedGenerate?.data.connectedTextNode, outputId);
  assert.equal(
    textConnectedGenerate?.data.prompt,
    interior.data.compiledPrompt,
  );

  assert.equal(
    enqueueGenerateTask({
      projectId: "project-1",
      sourceNodeId: interior.id,
      prompt: interior.data.compiledPrompt,
      model: "image-model-1",
      ratio: "Auto",
      resolution: "1K",
      referenceImages: [],
    }),
    null,
  );
  assert.equal(useTaskQueueStore.getState().tasks.length, 0);
});

test("duplicating an interior node keeps configuration without sharing output", () => {
  const interior = createInteriorNode();
  interior.data.outputTextNodeId = "text-1";

  const clone = cloneNodeForDuplicate(interior, [interior], () => "interior-2");
  assert.ok(clone);
  assert.deepEqual(clone.data.config, interior.data.config);
  assert.notEqual(clone.data.config, interior.data.config);
  assert.equal(clone.data.outputTextNodeId, null);
});

test("prompt output creation is one undoable graph transaction", () => {
  const interior = createInteriorNode();
  resetCanvas([interior]);

  useHistoryStore.getState().runTracked(() => {
    useCanvasStore.getState().materializeInteriorDesignPrompt(interior.id);
  });
  assert.equal(useCanvasStore.getState().nodes.length, 2);

  useHistoryStore.getState().undo();
  assert.equal(useCanvasStore.getState().nodes.length, 1);
  assert.equal(useCanvasStore.getState().edges.length, 0);

  useHistoryStore.getState().redo();
  assert.equal(useCanvasStore.getState().nodes.length, 2);
  assert.equal(useCanvasStore.getState().edges.length, 1);
});

test("linked prompt updates undo and redo as one graph transaction", () => {
  const interior = createInteriorNode();
  resetCanvas([interior]);
  const outputId = useCanvasStore
    .getState()
    .materializeInteriorDesignPrompt(interior.id);
  useHistoryStore.getState().clearHistory();

  const nextConfig = structuredClone(interior.data.config);
  nextConfig.customRequirement = "增加一张深绿色单椅";
  useHistoryStore.getState().runTracked(() => {
    useCanvasStore
      .getState()
      .updateInteriorDesignConfig(interior.id, nextConfig);
  });

  const updatedPrompt = compileInteriorDesignPrompt(nextConfig);
  assert.equal(
    useCanvasStore.getState().nodes.find((node) => node.id === outputId)?.data
      .text,
    updatedPrompt,
  );

  useHistoryStore.getState().undo();
  assert.equal(
    useCanvasStore.getState().nodes.find((node) => node.id === interior.id)
      ?.data.compiledPrompt,
    interior.data.compiledPrompt,
  );
  assert.equal(
    useCanvasStore.getState().nodes.find((node) => node.id === outputId)?.data
      .text,
    interior.data.compiledPrompt,
  );

  useHistoryStore.getState().redo();
  assert.equal(
    useCanvasStore.getState().nodes.find((node) => node.id === outputId)?.data
      .text,
    updatedPrompt,
  );
});

test("legacy interior snapshots shed image execution state without losing previews", () => {
  const interior = createInteriorNode();
  const image: Node = {
    id: "image-1",
    type: "imageNode",
    position: { x: 0, y: 0 },
    data: { imageUrl: "blob:image" },
  };
  const preview: Node = {
    id: "preview-1",
    type: "generatedPreviewNode",
    position: { x: 980, y: 0 },
    data: { imageUrl: "blob:preview", sourceGenerateNodeId: interior.id },
  };
  interior.data = {
    ...interior.data,
    sourceImageNodeId: image.id,
    model: "private-model",
    ratio: "16:9",
    resolution: "2K",
    status: "queued",
    errorMsg: "legacy",
    activeTaskId: "task-1",
  };

  useCanvasStore.getState().replaceSnapshot({
    nodes: [image, interior, preview],
    edges: [
      {
        id: "edge-image-interior",
        source: image.id,
        target: interior.id,
        targetHandle: "image",
      },
      {
        id: "edge-interior-preview",
        source: interior.id,
        sourceHandle: "image",
        target: preview.id,
      },
    ],
  });

  const state = useCanvasStore.getState();
  const restoredInterior = state.nodes.find((node) => node.id === interior.id);
  assert.deepEqual(Object.keys(restoredInterior?.data ?? {}).sort(), [
    "compiledPrompt",
    "config",
    "outputTextNodeId",
  ]);
  assert.equal(restoredInterior?.data.outputTextNodeId, null);
  assert.ok(state.nodes.some((node) => node.id === preview.id));
  assert.equal(state.edges.length, 0);
});

test("legacy interior snapshots migrate light entry state to config version two", () => {
  const interior = createInteriorNode();
  const legacyConfig = structuredClone(interior.data.config) as Omit<
    typeof interior.data.config,
    "schemaVersion" | "lighting"
  > & {
    schemaVersion: number;
    lighting: Omit<typeof interior.data.config.lighting, "lightEntryMode"> & {
      lightEntryEnabled?: boolean;
      lightEntryMode?: string;
    };
  };
  legacyConfig.schemaVersion = 1;
  delete legacyConfig.lighting.lightEntryMode;
  legacyConfig.lighting.lightEntryEnabled = true;
  interior.data.config = legacyConfig as unknown as typeof interior.data.config;

  useCanvasStore.getState().replaceSnapshot({ nodes: [interior], edges: [] });

  const restored = useCanvasStore.getState().nodes[0]?.data
    .config as InteriorDesignNodeData["config"];
  assert.equal(restored.schemaVersion, 2);
  assert.equal(restored.lighting.lightEntryMode, "detected-window");
});
