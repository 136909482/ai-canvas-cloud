import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import { enqueueEntourageEditTask } from "@/features/generateQueue/orchestrator.ts";
import { canvasNodeRegistrations } from "@/features/nodeRegistry/protocol.ts";
import { useCanvasStore } from "@/store/useCanvasStore.ts";
import { useHistoryStore } from "@/store/useHistoryStore.ts";
import { useSettingsStore } from "@/store/useSettingsStore.ts";
import { normalizeConfig } from "@/store/settingsConfig.ts";
import { useTaskQueueStore } from "@/store/useTaskQueueStore.ts";

function resetCanvas(nodes: Node[], edges: Edge[] = []) {
  useCanvasStore.setState({ nodes, edges, copiedNode: null });
  useHistoryStore.getState().clearHistory();
  useTaskQueueStore.getState().resetToEmpty();
}

function configureImageModel() {
  useSettingsStore.setState({
    config: normalizeConfig({
      providerProfiles: [
        {
          id: "provider-image",
          name: "Image Provider",
          protocol: "openai-compatible",
          authMode: "bearer",
          baseUrl: "https://images.example/v1",
          enabled: true,
          imageRequestMode: "sync",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      providerApiKeys: { "provider-image": "image-key" },
      modelEntries: [
        {
          id: "image-entry",
          providerProfileId: "provider-image",
          modelId: "gemini-2.5-flash-image",
          displayName: "Gemini Image",
          category: "image",
          source: "manual",
          status: "available",
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }),
  });
}

function createEntourageNode() {
  const registration = canvasNodeRegistrations.entourageNode.manual!;
  return registration.build(
    "entourage-1",
    { x: 100, y: 100 },
    registration.size,
  );
}

test("plant entourage queues one whole-image reference without a mask", () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    configureImageModel();
    resetCanvas([createEntourageNode()]);

    const source = {
      sourceNodeId: "image-1",
      imageUrl: "https://assets.example/building.png",
      assetRelativePath: "projects/project-1/building.png",
    };
    const taskId = enqueueEntourageEditTask({
      nodeId: "entourage-1",
      prompt: "合理增加植物配景",
      model: "image-entry",
      sourceImageNodeId: source.sourceNodeId,
      referenceImages: [source],
      ratio: "Auto",
      resolution: "1K",
    });

    assert.ok(taskId);
    const task = useTaskQueueStore
      .getState()
      .tasks.find((candidate) => candidate.id === taskId);
    assert.equal(task?.operationType, "image-to-image");
    assert.equal(task?.sourceImageNodeId, "image-1");
    assert.deepEqual(task?.referenceImages, [source]);
    assert.equal(task?.maskImageUrl, null);
    assert.equal(task?.editImageSource, null);
    assert.equal(task?.maskImageSource, null);
  } finally {
    useSettingsStore.setState({ config: originalConfig });
    resetCanvas([]);
  }
});

test("rich entourage queues one whole-image reference without a mask", () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    configureImageModel();
    resetCanvas([createEntourageNode()]);

    const source = {
      sourceNodeId: "image-1",
      imageUrl: "https://assets.example/building.png",
      assetRelativePath: "projects/project-1/building.png",
    };
    const taskId = enqueueEntourageEditTask({
      nodeId: "entourage-1",
      prompt:
        "保持建筑轮廓和道路不变。合理增加植物配景、少量真实可辨识的人物和蓝天白云；人物应有自然肤色、清晰服装与身体细节，姿态自然、脚部落地，尺度和光影与场景透视匹配，避免黑色剪影、纯黑影子或模糊无细节人物，不影响建筑",
      model: "image-entry",
      sourceImageNodeId: source.sourceNodeId,
      referenceImages: [source],
      ratio: "Auto",
      resolution: "1K",
    });

    assert.ok(taskId);
    const task = useTaskQueueStore
      .getState()
      .tasks.find((candidate) => candidate.id === taskId);
    assert.equal(task?.operationType, "image-to-image");
    assert.deepEqual(task?.referenceImages, [source]);
    assert.equal(task?.maskImageUrl, null);
    assert.equal(task?.editImageSource, null);
    assert.equal(task?.maskImageSource, null);
  } finally {
    useSettingsStore.setState({ config: originalConfig });
    resetCanvas([]);
  }
});

test("person entourage queues one whole-image reference without a mask", () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    configureImageModel();
    resetCanvas([createEntourageNode()]);

    const source = {
      sourceNodeId: "image-1",
      imageUrl: "https://assets.example/building.png",
      assetRelativePath: "projects/project-1/building.png",
    };
    const taskId = enqueueEntourageEditTask({
      nodeId: "entourage-1",
      prompt:
        "保持建筑轮廓和道路不变。合理增加少量真实可辨识的街道人物。以建筑门洞、首层层高、台阶和铺装分格为尺度基准，成年人物按约1.7米表现，人物应显著小于首层层高；优先布置在入口及人行道的中景和远景，严格遵循近大远小，距离越远人物越小，避免画面前景出现占画面高度过大的近景人物。人物应有自然肤色、清晰服装与身体细节，姿态自然、脚部落地，光影与场景匹配，避免黑色剪影、纯黑影子或模糊无细节人物，不影响建筑",
      model: "image-entry",
      sourceImageNodeId: source.sourceNodeId,
      referenceImages: [source],
      maskImageUrl: null,
      ratio: "Auto",
      resolution: "1K",
    });

    assert.ok(taskId);
    const task = useTaskQueueStore
      .getState()
      .tasks.find((candidate) => candidate.id === taskId);
    assert.equal(task?.operationType, "image-to-image");
    assert.deepEqual(task?.referenceImages, [source]);
    assert.equal(task?.maskImageUrl, null);
    assert.equal(task?.editImageSource, null);
    assert.equal(task?.maskImageSource, null);
  } finally {
    useSettingsStore.setState({ config: originalConfig });
    resetCanvas([]);
  }
});
