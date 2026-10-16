import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import type { Edge, Node } from "@xyflow/react";
import { canvasNodeRegistrations } from "@/features/nodeRegistry/protocol";
import {
  createRichPromptDocumentFromText,
  richPromptToPlainText,
} from "@/features/richPrompt/promptCompiler";
import type { RichPromptDocument } from "@/features/richPrompt/types";
import {
  canvasNodeToProjectGraphNode,
  projectGraphNodeToCanvasNode,
} from "@/platform/cloud/cloudProjectGraph";
import { syncConnectionDerivedNodeData } from "@/store/canvasConnectionDerivedData";
import {
  getGenerateReferenceSourceNodes,
  getGenerateTextSource,
} from "@/store/canvasConnectionSources";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import type { GenerateNodeData } from "@/types";
import { getGeneratePromptPatch } from "./generationControls";
import { getGenerateEditablePrompt } from "./generatePrompt";

const registration = canvasNodeRegistrations.generateNode.manual!;
const source: Node = {
  id: "text-source",
  type: "textNode",
  position: { x: 0, y: 0 },
  data: { text: "绘制山水画", richPrompt: null },
};
const edge: Edge = {
  id: "text-edge",
  source: source.id,
  sourceHandle: "output",
  target: "image-target",
  targetHandle: "prompt",
};
const createTarget = (data: Partial<GenerateNodeData> = {}): Node => {
  const node = registration.build(
    edge.target,
    { x: 400, y: 0 },
    registration.size,
  );
  return { ...node, data: { ...node.data, ...data } };
};
const targetData = () =>
  useCanvasStore.getState().nodes.find((node) => node.id === edge.target)!
    .data as GenerateNodeData;
const connect = (sourceId = source.id) =>
  useCanvasStore.getState().onConnect({
    source: sourceId,
    sourceHandle: "output",
    target: edge.target,
    targetHandle: "prompt",
  });
const edit = (
  prompt: string,
  richPrompt = createRichPromptDocumentFromText(prompt),
) =>
  useCanvasStore
    .getState()
    .updateNodeData(
      edge.target,
      getGeneratePromptPatch(targetData(), richPrompt, prompt),
    );

beforeEach(() => {
  useCanvasStore.setState({ nodes: [source, createTarget()], edges: [] });
  useHistoryStore.getState().clearHistory();
});
afterEach(() => {
  useHistoryStore.getState().clearHistory();
  useCanvasStore.setState({ nodes: [], edges: [] });
});

test("connected text stays in its source card while the editor only holds the addition", () => {
  connect();
  assert.deepEqual(getGenerateEditablePrompt(targetData()), {
    prompt: "",
    richPrompt: null,
  });
  assert.equal(targetData().prompt, source.data.text);
  edit("暖色光影，比例 2:3");
  assert.equal(targetData().prompt, "绘制山水画\n暖色光影，比例 2:3");
  assert.equal(
    getGenerateEditablePrompt(targetData()).prompt,
    "暖色光影，比例 2:3",
  );
  assert.equal(useCanvasStore.getState().nodes[0].data.text, "绘制山水画");

  useCanvasStore.getState().updateNodeData(source.id, { text: "绘制竹林" });
  assert.equal(targetData().prompt, "绘制竹林\n暖色光影，比例 2:3");
  const { nodes, edges } = useCanvasStore.getState();
  assert.equal(syncConnectionDerivedNodeData(nodes, edges), nodes);
});

test("text connection preserves an existing manual prompt as the addition", () => {
  edit("暖色光影");
  connect();
  assert.equal(targetData().prompt, "绘制山水画\n暖色光影");
  assert.equal(getGenerateEditablePrompt(targetData()).prompt, "暖色光影");
});

test("supplement editing participates in history and survives graph save/load", () => {
  connect();
  useHistoryStore.getState().beginTransaction();
  edit("柔和光影");
  edit("柔和光影，近景");
  useHistoryStore.getState().commitTransaction();
  const snapshot = useCanvasStore.getState().getSnapshot();
  const restored = snapshot.nodes.map((node) =>
    projectGraphNodeToCanvasNode(canvasNodeToProjectGraphNode(node)),
  );
  const loaded = syncConnectionDerivedNodeData(restored, snapshot.edges).find(
    (node) => node.id === edge.target,
  )!;
  assert.equal(getGenerateEditablePrompt(loaded.data).prompt, "柔和光影，近景");
  assert.equal(loaded.data.prompt, "绘制山水画\n柔和光影，近景");
  useHistoryStore.getState().undo();
  assert.equal(getGenerateEditablePrompt(targetData()).prompt, "");
  assert.equal(targetData().prompt, "绘制山水画");
  useHistoryStore.getState().redo();
  assert.equal(targetData().prompt, "绘制山水画\n柔和光影，近景");
});

test("disconnect removes only the text edge and retains the addition with undo and reconnect", () => {
  const image: Node = {
    id: "reference-image",
    type: "imageNode",
    position: { x: -400, y: 0 },
    data: { imageUrl: "https://assets.example/reference.png" },
  };
  useCanvasStore.setState({ nodes: [source, image, createTarget()] });
  connect();
  connect(image.id);
  edit("柔和光影");
  useHistoryStore
    .getState()
    .runTracked(() =>
      useCanvasStore
        .getState()
        .deleteEdgesBySourceTargetExceptHandle(source.id, edge.target, "mask"),
    );
  assert.equal(targetData().connectedTextNode, null);
  assert.equal(targetData().prompt, "柔和光影");
  assert.equal(targetData().promptSupplement, null);
  assert.equal(useCanvasStore.getState().edges.length, 1);
  assert.equal(useCanvasStore.getState().edges[0].source, image.id);
  useHistoryStore.getState().undo();
  assert.equal(targetData().prompt, "绘制山水画\n柔和光影");
  useHistoryStore.getState().redo();
  connect();
  assert.equal(targetData().prompt, "绘制山水画\n柔和光影");
  useCanvasStore.getState().deleteNode(source.id);
  assert.equal(targetData().connectedTextNode, null);
  assert.equal(targetData().prompt, "柔和光影");
});

test("legacy connected projects do not duplicate their synchronized prompt in the editor", () => {
  const legacy = createTarget({
    connectedTextNode: source.id,
    prompt: "绘制山水画",
    richPrompt: createRichPromptDocumentFromText("绘制山水画"),
  });
  const nodes = syncConnectionDerivedNodeData([source, legacy], [edge]);
  assert.equal(getGenerateEditablePrompt(nodes[1].data).prompt, "");
  assert.equal(nodes[1].data.prompt, "绘制山水画");
  assert.equal(syncConnectionDerivedNodeData(nodes, [edge]), nodes);
});

test("replacing the text source keeps the addition and splitter references use the selected part", () => {
  connect();
  edit("柔和光影");
  const splitter: Node = {
    id: "splitter",
    type: "inlineTextSplitterNode",
    position: { x: 0, y: 400 },
    data: { parts: ["第一段", "第二段"] },
  };
  useCanvasStore.setState({
    nodes: [...useCanvasStore.getState().nodes, splitter],
  });
  useCanvasStore.getState().onConnect({
    source: splitter.id,
    sourceHandle: "part-1",
    target: edge.target,
    targetHandle: "prompt",
  });
  const { nodes, edges } = useCanvasStore.getState();
  assert.equal(getGenerateTextSource(nodes, edges, edge.target).text, "第二段");
  assert.equal(targetData().prompt, "第二段\n柔和光影");
});

test("upstream and supplemental image mentions survive composition and collect both references", () => {
  const mentionDocument = (sourceId: string): RichPromptDocument => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "imageMention",
            attrs: {
              sourceNodeId: sourceId,
              label: sourceId,
              imageUrl: `https://assets.example/${sourceId}.png`,
            },
          },
        ],
      },
    ],
  });
  const upstream = mentionDocument("upstream");
  const addition = mentionDocument("addition");
  useCanvasStore.setState({
    nodes: [
      { ...source, data: { text: "@upstream", richPrompt: upstream } },
      createTarget(),
      ...["upstream", "addition"].map((id) => ({
        id,
        type: "imageNode",
        position: { x: -400, y: 0 },
        data: { imageUrl: `https://assets.example/${id}.png` },
      })),
    ],
  });
  connect();
  edit("@addition", addition);
  assert.equal(
    richPromptToPlainText(targetData().richPrompt),
    "@upstream\n@addition",
  );
  assert.deepEqual(
    getGenerateEditablePrompt(targetData()).richPrompt,
    addition,
  );
  assert.deepEqual(
    getGenerateReferenceSourceNodes(
      useCanvasStore.getState().nodes,
      edge.target,
    ).map((node) => node.id),
    ["upstream", "addition"],
  );
  // Updating mention attributes with unchanged plain text must still propagate.
  const changed = structuredClone(upstream);
  changed.content![0].content![0] = {
    type: "imageMention",
    attrs: {
      sourceNodeId: "new-source",
      label: "upstream",
      imageUrl: "new.png",
    },
  };
  useCanvasStore.getState().updateNodeData(source.id, { richPrompt: changed });
  assert.deepEqual(targetData().richPrompt?.content?.[0], changed.content?.[0]);
});

test("empty sources allow supplemental input and empty additions preserve source-only generation", () => {
  useCanvasStore.getState().updateNodeData(source.id, { text: "  " });
  connect();
  assert.equal(targetData().prompt, "");
  edit("仅补充内容");
  assert.equal(targetData().prompt, "仅补充内容");
  useCanvasStore.getState().updateNodeData(source.id, { text: "新的来源" });
  edit("");
  assert.equal(targetData().prompt, "新的来源");
});

test("an empty rich document does not suppress the legacy plain-text source when composing", () => {
  useCanvasStore.getState().updateNodeData(source.id, {
    richPrompt: createRichPromptDocumentFromText(""),
  });
  connect();
  edit("柔和光影");
  assert.equal(targetData().prompt, "绘制山水画\n柔和光影");
  assert.equal(
    richPromptToPlainText(targetData().richPrompt),
    targetData().prompt,
  );
});
