import assert from "node:assert/strict";
import test from "node:test";
import { canvasNodeRegistrations } from "@/features/nodeRegistry/protocol";
import { createRichPromptDocumentFromText } from "@/features/richPrompt/promptCompiler";
import { getNodeModelSelection } from "@/features/settings/nodeModelSelection";
import { normalizeConfig } from "@/store/settingsConfig";
import { selectSingleSelectedGenerateNode } from "@/store/canvasStoreSelectors";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { syncSourceNodeAfterTaskSettles } from "@/features/generateQueue/taskCanvasState";
import { retryGenerateTask } from "@/features/generateQueue/orchestrator";
import type { RichPromptDocument } from "@/features/richPrompt/types";
import type { GenerateNodeData } from "@/types";
import {
  buildGenerateSubmission,
  canConfigureGenerateBackground,
  canConfigureGenerateQuality,
  enqueueGenerateSubmission,
  getGeneratePromptPatch,
} from "./generationControls";
import { getConnectedGeneratePromptPatch } from "./generatePrompt";
import { getInlineImageResultIds } from "./imageNodePresentation";

const registration = canvasNodeRegistrations.generateNode.manual!;
const config = normalizeConfig({
  providerProfiles: [
    {
      id: "provider-image",
      name: "测试图片服务",
      protocol: "openai-compatible",
      authMode: "bearer",
      baseUrl: "https://images.example/v1",
      enabled: true,
      imageRequestMode: "sync",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  providerApiKeys: { "provider-image": "test-only-key" },
  modelEntries: [
    {
      id: "image-entry",
      providerProfileId: "provider-image",
      modelId: "gpt-image-1",
      displayName: "GPT Image",
      category: "image",
      source: "manual",
      status: "available",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
});
function createNode(id = "generate-1") {
  return {
    ...registration.build(id, { x: 0, y: 0 }, registration.size),
    selected: true,
  };
}
function createData(patch: Partial<GenerateNodeData> = {}): GenerateNodeData {
  return {
    ...(createNode().data as GenerateNodeData),
    prompt: "绘制一幅山水画",
    model: "image-entry",
    ratio: "16:9",
    resolution: "2K",
    quality: "high",
    negativePrompt: "模糊",
    ...patch,
  };
}
function submit(
  data = createData(),
  extras: Partial<Parameters<typeof buildGenerateSubmission>[0]> = {},
) {
  return buildGenerateSubmission({
    id: "generate-1",
    projectId: "project-1",
    data,
    modelSelection: getNodeModelSelection(config, {
      category: "image",
      reference: data.model,
    }),
    references: [],
    richPromptReferences: [],
    maskSource: null,
    ...extras,
  });
}

test("generation panel selects exactly one AI image node and hides for all other selections", () => {
  const node = createNode();
  assert.equal(selectSingleSelectedGenerateNode({ nodes: [node] }), node);
  assert.equal(
    selectSingleSelectedGenerateNode({ nodes: [{ ...node, selected: false }] }),
    null,
  );
  assert.equal(selectSingleSelectedGenerateNode({ nodes: [] }), null);
  assert.equal(
    selectSingleSelectedGenerateNode({ nodes: [node, createNode("second")] }),
    null,
  );
  for (const type of [
    "videoGenerateNode",
    "videoNode",
    "textNode",
    "imageNode",
    "groupNode",
  ]) {
    assert.equal(
      selectSingleSelectedGenerateNode({ nodes: [{ ...node, type }] }),
      null,
    );
    assert.equal(
      selectSingleSelectedGenerateNode({
        nodes: [node, { ...node, id: "other", type }],
      }),
      null,
    );
  }
});

test("selection follows node updates and cannot retain a deleted node", () => {
  const node = createNode();
  const updated = { ...node, data: createData({ prompt: "新提示词" }) };
  assert.equal(
    selectSingleSelectedGenerateNode({ nodes: [updated] })?.data.prompt,
    "新提示词",
  );
  assert.equal(selectSingleSelectedGenerateNode({ nodes: [] }), null);
});

test("bottom prompt editing writes rich and plain text into the node with undo support", () => {
  const originalNodes = useCanvasStore.getState().nodes;
  const originalEdges = useCanvasStore.getState().edges;
  const node = { ...createNode(), data: createData({ status: "generating" }) };
  try {
    useCanvasStore.setState({ nodes: [node], edges: [] });
    useHistoryStore.getState().clearHistory();
    const richPrompt = createRichPromptDocumentFromText("更新后的画面");
    const patch = getGeneratePromptPatch(node.data, richPrompt, "更新后的画面");
    assert.ok(patch);
    useHistoryStore.getState().beginTransaction();
    useCanvasStore.getState().updateNodeData(node.id, patch);
    useHistoryStore.getState().commitTransaction();
    const updated = selectSingleSelectedGenerateNode(useCanvasStore.getState());
    assert.equal(updated?.data.prompt, "更新后的画面");
    assert.deepEqual(updated?.data.richPrompt, richPrompt);
    assert.equal(updated?.data.status, "generating");
    assert.equal(
      useCanvasStore.getState().getSnapshot().nodes[0]?.data.prompt,
      "更新后的画面",
    );
    useHistoryStore.getState().undo();
    assert.equal(
      useCanvasStore.getState().nodes[0]?.data.prompt,
      node.data.prompt,
    );
  } finally {
    useHistoryStore.getState().clearHistory();
    useCanvasStore.setState({ nodes: originalNodes, edges: originalEdges });
  }
});

test("connected text edits update the supplement without overwriting the upstream prompt", () => {
  const data = createData({
    connectedTextNode: "text-1",
    prompt: "连接的提示词",
  });
  const richPrompt = createRichPromptDocumentFromText("补充光影");
  assert.deepEqual(getGeneratePromptPatch(data, richPrompt, "补充光影"), {
    promptSupplement: { prompt: "补充光影", richPrompt },
  });
  const edited = {
    ...data,
    ...getGeneratePromptPatch(data, richPrompt, "补充光影"),
  };
  const combined = {
    ...edited,
    ...getConnectedGeneratePromptPatch(edited, {
      sourceId: "text-1",
      text: "连接的提示词",
      richPrompt: null,
    }),
  };
  const result = submit(combined);
  assert.equal(result.kind, "ready");
  if (result.kind === "ready") {
    assert.equal(result.task.prompt, "连接的提示词\n补充光影");
    assert.equal(result.task.sourceNodeId, "generate-1");
    assert.equal(result.task.model, "image-entry");
  }
  assert.equal(submit(data).kind, "ready");
});

test("combined image mentions use the target's reference order in the submitted prompt", () => {
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
              label: "旧图片标签",
              imageUrl: "old.png",
            },
          },
        ],
      },
    ],
  });
  const data = createData({
    connectedTextNode: "text-1",
    promptSupplement: {
      prompt: "@旧图片标签",
      richPrompt: mentionDocument("addition"),
    },
  });
  const combined = {
    ...data,
    ...getConnectedGeneratePromptPatch(data, {
      sourceId: "text-1",
      text: "@旧图片标签",
      richPrompt: mentionDocument("upstream"),
    }),
  };
  const references = ["addition", "upstream"].map((sourceId) => ({
    sourceId,
    imageUrl: `https://assets.example/${sourceId}.png`,
  }));
  const result = submit(combined, {
    references,
    richPromptReferences: references.map((image, index) => ({
      ...image,
      label: `图片${index + 1}`,
      order: index + 1,
    })),
  });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.match(
    result.task.prompt,
    /@图片1 = reference image 1 = image_urls\[0\]/,
  );
  assert.match(
    result.task.prompt,
    /@图片2 = reference image 2 = image_urls\[1\]/,
  );
  assert.match(result.task.prompt, /User request:\n@图片2\n@图片1$/);
});

test("bottom submission preserves the original node queue parameters", () => {
  const result = submit(createData({ prompt: "  绘制一幅山水画  " }));
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.deepEqual(result.task, {
    projectId: "project-1",
    sourceNodeId: "generate-1",
    prompt: "绘制一幅山水画",
    negativePrompt: "模糊",
    model: "image-entry",
    ratio: "16:9",
    resolution: "2K",
    quality: "high",
    background: "auto",
    operationType: undefined,
    sourceImageNodeId: null,
    maskImageUrl: null,
    editImageSource: null,
    maskImageSource: null,
    referenceImages: [],
    googleSearch: false,
    googleImageSearch: false,
  });
  assert.equal(result.patch.prompt, "绘制一幅山水画");
  assert.equal(result.outputCount, 1);
});

test("batch submission creates independent tasks and preserves every completed image", () => {
  const originalCanvas = useCanvasStore.getState();
  const originalTasks = useTaskQueueStore.getState().tasks;
  try {
    for (const outputCount of [1, 2, 4]) {
      const data = createData({ outputCount, background: "transparent" });
      useCanvasStore.setState({
        nodes: [{ ...createNode(), data }],
        edges: [],
      });
      useTaskQueueStore.setState({ tasks: [] });
      const result = submit(data);
      assert.equal(result.kind, "ready");
      if (result.kind !== "ready") continue;
      assert.equal(result.outputCount, outputCount);
      const ids = enqueueGenerateSubmission(result);
      const tasks = useTaskQueueStore.getState().tasks;
      assert.equal(ids.length, outputCount);
      assert.equal(new Set(ids).size, outputCount);
      assert.equal(
        new Set(tasks.map((task) => task.previewNodeId)).size,
        outputCount,
      );
      for (const task of tasks) {
        assert.equal(task.status, "queued");
        assert.equal(task.prompt, result.task.prompt);
        assert.equal(task.projectId, result.task.projectId);
        assert.equal(task.sourceNodeId, result.task.sourceNodeId);
        assert.equal(task.model, result.task.model);
        assert.equal(task.ratio, result.task.ratio);
        assert.equal(task.resolution, result.task.resolution);
        assert.equal(task.quality, result.task.quality);
        assert.equal(task.background, "transparent");
        assert.deepEqual(task.referenceImages, result.task.referenceImages);
        assert.equal("outputCount" in task, false);
        assert.equal(
          useCanvasStore
            .getState()
            .nodes.find((node) => node.id === task.previewNodeId)?.data
            .resultDisplay,
          outputCount === 1 ? "inline" : "canvas",
        );
      }
      for (const [index, task] of [...tasks].reverse().entries()) {
        const imageUrl = `https://assets.example/${task.id}.png`;
        assert.ok(task.previewNodeId);
        useCanvasStore
          .getState()
          .updateNodeData(task.previewNodeId, { imageUrl, status: "done" });
        useTaskQueueStore.getState().markTaskDone(task.id);
        const settled = useTaskQueueStore
          .getState()
          .tasks.find((candidate) => candidate.id === task.id)!;
        syncSourceNodeAfterTaskSettles(settled, { status: "done", imageUrl });
        assert.equal(
          useCanvasStore
            .getState()
            .nodes.find((node) => node.id === "generate-1")?.data.status,
          index === outputCount - 1 ? "done" : "queued",
        );
      }
      const canvas = useCanvasStore.getState();
      const hiddenResults = getInlineImageResultIds(canvas.nodes, canvas.edges);
      const visibleImages = canvas.nodes.filter(
        (node) => node.data.imageUrl && !hiddenResults.has(node.id),
      );
      assert.equal(visibleImages.length, outputCount);
      assert.equal(
        new Set(visibleImages.map((node) => node.data.imageUrl)).size,
        outputCount,
      );
      assert.equal(
        canvas.getSnapshot().nodes.find((node) => node.id === "generate-1")
          ?.data.outputCount,
        outputCount,
      );
      canvas.updateNodeData("generate-1", { outputCount: 1 });
      const changed = useCanvasStore.getState();
      const hiddenAfterCountEdit = getInlineImageResultIds(
        changed.nodes,
        changed.edges,
      );
      assert.equal(
        changed.nodes.filter(
          (node) => node.data.imageUrl && !hiddenAfterCountEdit.has(node.id),
        ).length,
        outputCount,
      );
    }
  } finally {
    useCanvasStore.setState({
      nodes: originalCanvas.nodes,
      edges: originalCanvas.edges,
    });
    useTaskQueueStore.setState({ tasks: originalTasks });
  }
});

test("repeated single-image generation updates only the current card after movement, count edits and restore", (context) => {
  let timestamp = 1000;
  context.mock.method(Date, "now", () => timestamp++);
  const originalCanvas = useCanvasStore.getState();
  const originalTasks = useTaskQueueStore.getState().tasks;
  try {
    const data = createData();
    useCanvasStore.setState({
      nodes: [{ ...createNode(), data }],
      edges: [],
    });
    useTaskQueueStore.setState({ tasks: [] });
    const imageUrls = [
      "https://assets.example/first.png",
      "https://assets.example/second.png",
    ];
    for (const [index, imageUrl] of imageUrls.entries()) {
      const result = submit(data);
      assert.equal(result.kind, "ready");
      if (result.kind !== "ready") continue;
      const [taskId] = enqueueGenerateSubmission(result);
      const task = useTaskQueueStore
        .getState()
        .tasks.find((candidate) => candidate.id === taskId)!;
      assert.ok(task.previewNodeId);
      useCanvasStore
        .getState()
        .updateNodeData(task.previewNodeId, { imageUrl, status: "done" });
      useTaskQueueStore.getState().markTaskDone(task.id);
      syncSourceNodeAfterTaskSettles(task, { status: "done", imageUrl });
      useCanvasStore.getState().onNodesChange([
        {
          id: task.previewNodeId,
          type: "position",
          position: { x: 600, y: index * 400 },
          dragging: false,
        },
      ]);
      const canvas = useCanvasStore.getState();
      const hidden = getInlineImageResultIds(canvas.nodes, canvas.edges);
      const visibleImages = canvas.nodes.filter(
        (node) => node.data.imageUrl && !hidden.has(node.id),
      );
      assert.equal(hidden.has(task.previewNodeId), true);
      assert.deepEqual(
        new Set(visibleImages.map((node) => node.data.imageUrl)),
        new Set([imageUrl]),
      );
      assert.equal(visibleImages.length, 1);
      assert.deepEqual(visibleImages[0].position, createNode().position);
      assert.equal(
        canvas.nodes.find((node) => node.id === "generate-1")?.data.imageUrl,
        imageUrl,
      );
    }
    const canvas = useCanvasStore.getState();
    assert.equal(
      canvas.nodes.filter((node) => node.type === "generatedPreviewNode")
        .length,
      2,
    );
    assert.equal(canvas.edges.length, 2);
    canvas.updateNodeData("generate-1", { outputCount: 4 });
    const snapshot = useCanvasStore.getState().getSnapshot();
    assert.ok(snapshot.nodes.every((node) => !node.hidden));
    useCanvasStore.setState(snapshot);
    const restored = useCanvasStore.getState();
    const hidden = getInlineImageResultIds(restored.nodes, restored.edges);
    assert.equal(hidden.size, 2);
    assert.deepEqual(
      restored.nodes
        .filter((node) => node.data.imageUrl && !hidden.has(node.id))
        .map((node) => node.data.imageUrl),
      [imageUrls[1]],
    );
  } finally {
    useCanvasStore.setState({
      nodes: originalCanvas.nodes,
      edges: originalCanvas.edges,
    });
    useTaskQueueStore.setState({ tasks: originalTasks });
  }
});

test("output count edits use node snapshots and history, with a safe default for older projects", () => {
  const originalCanvas = useCanvasStore.getState();
  try {
    const node = createNode();
    useCanvasStore.setState({ nodes: [node], edges: [] });
    useHistoryStore.getState().clearHistory();
    useHistoryStore
      .getState()
      .runTracked(() =>
        useCanvasStore.getState().updateNodeData(node.id, { outputCount: 4 }),
      );
    assert.equal(
      useCanvasStore.getState().getSnapshot().nodes[0].data.outputCount,
      4,
    );
    useHistoryStore.getState().undo();
    assert.equal(useCanvasStore.getState().nodes[0].data.outputCount, 1);
    useHistoryStore.getState().redo();
    assert.equal(useCanvasStore.getState().nodes[0].data.outputCount, 4);
    for (const outputCount of [undefined, 3, 5, 999]) {
      const result = submit(createData({ outputCount }));
      assert.equal(result.kind, "ready");
      if (result.kind === "ready") assert.equal(result.outputCount, 1);
    }
  } finally {
    useHistoryStore.getState().clearHistory();
    useCanvasStore.setState({
      nodes: originalCanvas.nodes,
      edges: originalCanvas.edges,
    });
  }
});

test("image mentions compile against the same ordered reference list as the node", () => {
  const richPrompt: RichPromptDocument = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "使用 " },
          {
            type: "imageMention",
            attrs: {
              sourceNodeId: "style",
              imageUrl: "https://assets.example/style.png",
              label: "图片2",
            },
          },
        ],
      },
    ],
  };
  const references = [
    { sourceId: "base", imageUrl: "https://assets.example/base.png" },
    { sourceId: "style", imageUrl: "https://assets.example/style.png" },
  ];
  const result = submit(createData({ prompt: "使用 @图片2", richPrompt }), {
    references,
    richPromptReferences: references.map((image, index) => ({
      ...image,
      label: `图片${index + 1}`,
      order: index + 1,
    })),
  });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.match(
    result.task.prompt,
    /@图片2 = reference image 2 = image_urls\[1\]/,
  );
  assert.match(result.task.prompt, /User request:\n使用 @图片2/);
  assert.equal(result.task.referenceImages?.[1]?.sourceNodeId, "style");
});

test("mask submission keeps the base image separate and preserves reference order and asset paths", () => {
  const references = [
    {
      sourceId: "base",
      imageUrl: "https://assets.example/base.png",
      assetRelativePath: "assets/base.png",
    },
    { sourceId: "style", imageUrl: "https://assets.example/style.png" },
  ];
  const maskSource = {
    sourceId: "mask",
    imageUrl: "https://assets.example/mask.png",
    assetRelativePath: "assets/mask.png",
  };
  const result = submit(createData({ maskInputEnabled: true }), {
    references,
    maskSource,
  });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.task.operationType, "image-edit");
  assert.equal(result.task.sourceImageNodeId, "base");
  assert.deepEqual(result.task.editImageSource, {
    sourceNodeId: "base",
    imageUrl: references[0].imageUrl,
    assetRelativePath: "assets/base.png",
  });
  assert.deepEqual(result.task.maskImageSource, {
    sourceNodeId: "mask",
    imageUrl: maskSource.imageUrl,
    assetRelativePath: "assets/mask.png",
  });
  assert.deepEqual(result.task.referenceImages, [
    {
      sourceNodeId: "style",
      imageUrl: references[1].imageUrl,
      assetRelativePath: null,
    },
  ]);
});

test("empty prompts and unavailable models keep their original validation behavior", () => {
  assert.deepEqual(submit(createData({ prompt: " \n " })), { kind: "empty" });
  assert.deepEqual(submit(createData({ model: "deleted-model" })), {
    kind: "error",
    message: "已删除",
  });
  assert.deepEqual(submit(createData({ model: "" })), {
    kind: "error",
    message: "请选择可用的图像服务商和模型。",
  });
});

test("a mask without a base image retains the existing error and disabled masks are ignored", () => {
  const maskSource = {
    sourceId: "mask",
    imageUrl: "https://assets.example/mask.png",
  };
  assert.deepEqual(
    submit(createData({ maskInputEnabled: true }), { maskSource }),
    { kind: "error", message: "使用蒙版重绘需要同时连接原图和蒙版" },
  );
  const result = submit(createData({ maskInputEnabled: false }), {
    maskSource,
  });
  assert.equal(result.kind, "ready");
  if (result.kind === "ready") assert.equal(result.task.maskImageSource, null);
});

test("official selections preserve the opaque model reference and respect the runtime switch", () => {
  const data = createData({ model: "official:public-model" });
  const modelSelection = getNodeModelSelection(config, {
    category: "image",
    reference: data.model,
    officialGenerationEnabled: true,
  });
  const result = submit(data, { modelSelection });
  assert.equal(result.kind, "ready");
  if (result.kind === "ready")
    assert.equal(result.task.model, "official:public-model");
  assert.deepEqual(
    submit(data, {
      modelSelection: getNodeModelSelection(config, {
        category: "image",
        reference: data.model,
        officialGenerationEnabled: false,
      }),
    }),
    { kind: "error", message: "官方接口服务已关闭" },
  );
});

test("background controls and submission are limited to GPT Image through OpenAI-compatible providers", () => {
  const data = createData({ background: "transparent" });
  const selection = getNodeModelSelection(config, {
    category: "image",
    reference: data.model,
  });
  assert.equal(canConfigureGenerateBackground(selection), true);
  for (const background of ["auto", "opaque", "transparent"] as const) {
    const result = submit({ ...data, background });
    assert.equal(result.kind, "ready");
    if (result.kind === "ready")
      assert.equal(result.task.background, background);
  }
  const legacy = submit(createData({ background: undefined }));
  assert.equal(legacy.kind, "ready");
  if (legacy.kind === "ready") assert.equal(legacy.task.background, "auto");
  const alternateSelections = [
    {
      ...selection,
      selectedModel: {
        ...selection.selectedModel!,
        modelId: "gemini-3-pro-image-preview",
      },
    },
    {
      ...selection,
      selectedProvider: {
        ...selection.selectedProvider!,
        protocol: "custom-http-image-v1" as const,
      },
    },
    getNodeModelSelection(config, {
      category: "image",
      reference: "official:public-model",
      officialGenerationEnabled: true,
    }),
  ];
  for (const modelSelection of alternateSelections) {
    assert.equal(canConfigureGenerateBackground(modelSelection), false);
    const result = submit(data, { modelSelection });
    assert.equal(result.kind, "ready");
    if (result.kind === "ready")
      assert.equal("background" in result.task, false);
  }
});

test("official templates enable GPT controls and preserve their values without a local model entry", () => {
  for (const parameterTemplate of [
    "gpt-image",
    "nano-banana",
    "generic",
  ] as const) {
    const data = createData({
      model: "official:public-model",
      background: "transparent",
    });
    const selection = getNodeModelSelection(config, {
      category: "image",
      reference: data.model,
    });
    const officialModels = [
      {
        id: "public-model",
        name: "不依赖展示名称",
        parameterTemplate,
        capabilities: { generate: true, edit: true, references: true },
        prices: { "1K": 1, "2K": 2, "4K": 4 },
      },
    ];
    const isGpt = parameterTemplate === "gpt-image";
    assert.equal(selection.selectedModel, null);
    assert.equal(canConfigureGenerateQuality(selection, officialModels), isGpt);
    assert.equal(
      canConfigureGenerateBackground(selection, officialModels),
      isGpt,
    );
    const result = submit(data, { modelSelection: selection, officialModels });
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") continue;
    assert.equal(result.task.model, data.model);
    assert.equal(result.task.quality, isGpt ? "high" : null);
    assert.equal(result.task.background, isGpt ? "transparent" : undefined);
    assert.equal(result.task.ratio, "16:9");
    assert.equal(result.task.resolution, "2K");
  }
});

test("background survives node history, saved tasks, recovery and retry without reading newer node parameters", () => {
  const originalCanvas = useCanvasStore.getState();
  const originalTasks = useTaskQueueStore.getState().tasks;
  try {
    const node = { ...createNode(), data: createData() };
    useCanvasStore.setState({ nodes: [node], edges: [] });
    useTaskQueueStore.setState({ tasks: [] });
    useHistoryStore.getState().clearHistory();
    useHistoryStore
      .getState()
      .runTracked(() =>
        useCanvasStore
          .getState()
          .updateNodeData(node.id, { background: "transparent" }),
      );
    assert.equal(
      useCanvasStore.getState().getSnapshot().nodes[0].data.background,
      "transparent",
    );
    useHistoryStore.getState().undo();
    assert.equal(useCanvasStore.getState().nodes[0].data.background, "auto");
    useHistoryStore.getState().redo();
    const result = submit(
      useCanvasStore.getState().nodes[0].data as GenerateNodeData,
    );
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    const [taskId] = enqueueGenerateSubmission(result);
    assert.ok(taskId);
    const snapshot = useTaskQueueStore.getState().getSnapshot();
    assert.equal(snapshot.tasks[0].background, "transparent");
    useTaskQueueStore.getState().replaceSnapshot(snapshot);
    assert.equal(
      useTaskQueueStore.getState().tasks[0].background,
      "transparent",
    );
    useCanvasStore
      .getState()
      .updateNodeData(node.id, { background: "opaque", outputCount: 4 });
    useTaskQueueStore.getState().markTaskError(taskId, "test-only failure");
    assert.equal(retryGenerateTask(taskId), taskId);
    assert.equal(
      useTaskQueueStore.getState().tasks[0].background,
      "transparent",
    );
    const retriedCanvas = useCanvasStore.getState();
    const retriedPreviewId =
      useTaskQueueStore.getState().tasks[0].previewNodeId!;
    assert.equal(
      retriedCanvas.nodes.find((node) => node.id === retriedPreviewId)?.data
        .resultDisplay,
      "inline",
    );
    assert.equal(
      getInlineImageResultIds(retriedCanvas.nodes, retriedCanvas.edges).has(
        retriedPreviewId,
      ),
      true,
    );
    const legacyTasks = snapshot.tasks.map((task) => {
      const legacy = { ...task };
      delete legacy.background;
      return legacy;
    });
    useTaskQueueStore.getState().replaceSnapshot({ tasks: legacyTasks });
    assert.equal(useTaskQueueStore.getState().tasks[0].background, null);
  } finally {
    useHistoryStore.getState().clearHistory();
    useCanvasStore.setState({
      nodes: originalCanvas.nodes,
      edges: originalCanvas.edges,
    });
    useTaskQueueStore.setState({ tasks: originalTasks });
  }
});
