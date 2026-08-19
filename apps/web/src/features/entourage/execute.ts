import { enqueueEntourageEditTask } from "@/features/generateQueue/orchestrator";
import { getPreferredSelectableModelEntryId } from "@/features/settings/nodeModelSelection";
import { resolveRuntimeModelConfig } from "@/features/settings/providerConfig";
import { platformBridge } from "@/platform";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { getWorkspaceAssetRelativePath } from "@/utils/workspaceImageAsset";
import type { EntourageFeature, GenerateTaskImageSource } from "@/types";
import { createPlacementMaskDataUrl } from "./mask";
import {
  buildEntourageEditPrompt,
  buildWholeImageEntouragePrompt,
  isWholeImageEntourageFeature,
  planEntouragePlacements,
} from "./planning";

const UI_TEXT = {
  noSourceImage: "请先连接一张图片到主图接口。",
  noChatModel: "暂无可用 Chat 模型（用于 AI 规划），请先在模型设置中启用。",
  noImageModel: "暂无可用图片模型，请先在模型设置中启用。",
  planningFailed:
    "AI 配景规划失败，未得到有效放置计划，请重试或更换 Chat 模型。",
  maskFailed: "无法生成配景蒙版，请确认图片可正常访问。",
  enqueueFailed: "无法创建配景生成任务，请检查重绘模型配置后重试。",
} as const;

async function resolveEntourageImageUrl(
  source: GenerateTaskImageSource,
  allowFallback: boolean,
) {
  if (!source.assetRelativePath) return source.imageUrl;

  try {
    return await platformBridge.resolveWorkspaceAssetUrl(
      source.assetRelativePath,
    );
  } catch (error) {
    if (allowFallback && source.imageUrl) return source.imageUrl;
    throw error;
  }
}

function isPlanningImageReadFailure(error: unknown) {
  return error instanceof Error && error.message.trim() === "规划图片读取失败";
}

export function getEntourageSourceImage(nodeId: string) {
  const canvasStore = useCanvasStore.getState();
  const node = canvasStore.nodes.find(
    (candidate) =>
      candidate.id === nodeId && candidate.type === "entourageNode",
  );
  if (!node) return null;

  const sourceImageNodeId =
    typeof node.data?.sourceImageNodeId === "string"
      ? node.data.sourceImageNodeId
      : null;
  if (!sourceImageNodeId) return null;

  const sourceNode = canvasStore.nodes.find(
    (candidate) => candidate.id === sourceImageNodeId,
  );
  const imageUrl =
    typeof sourceNode?.data?.imageUrl === "string"
      ? sourceNode.data.imageUrl
      : "";
  if (!sourceNode || !imageUrl) return null;

  return {
    sourceNodeId: sourceNode.id,
    imageUrl,
    assetRelativePath:
      getWorkspaceAssetRelativePath(sourceNode.data.imageAsset) ?? null,
  } satisfies GenerateTaskImageSource;
}

function resolveModelConfig(modelEntryId: string, category: "chat" | "image") {
  if (!modelEntryId) return null;

  const resolution = resolveRuntimeModelConfig(
    useSettingsStore.getState().config,
    {
      modelEntryId,
      category,
      requireCredentials: true,
    },
  );
  return resolution.ok ? resolution.runtimeConfig : null;
}

export async function runEntourageFeature(
  nodeId: string,
  feature: EntourageFeature,
) {
  const canvasStore = useCanvasStore.getState();
  const node = canvasStore.nodes.find(
    (candidate) =>
      candidate.id === nodeId && candidate.type === "entourageNode",
  );
  if (!node) return;

  const source = getEntourageSourceImage(nodeId);
  if (!source) {
    canvasStore.updateNodeData(nodeId, {
      feature,
      status: "error",
      errorMsg: UI_TEXT.noSourceImage,
    });
    return;
  }

  canvasStore.updateNodeData(nodeId, {
    feature,
    status: "generating",
    errorMsg: "",
    ...(isWholeImageEntourageFeature(feature) ? { placements: [] } : {}),
  });

  try {
    let sourceImageUrl = await resolveEntourageImageUrl(source, true);
    const imageModel =
      typeof node.data?.model === "string" ? node.data.model.trim() : "";
    const imageModelConfig = resolveModelConfig(imageModel, "image");
    if (!imageModelConfig) {
      throw new Error(UI_TEXT.noImageModel);
    }

    if (isWholeImageEntourageFeature(feature)) {
      const prompt = buildWholeImageEntouragePrompt(feature);
      const taskId = enqueueEntourageEditTask({
        projectId: useProjectStore.getState().activeProjectId,
        nodeId,
        prompt,
        model: imageModel,
        sourceImageNodeId: source.sourceNodeId,
        maskImageUrl: null,
        referenceImages: [{ ...source, imageUrl: sourceImageUrl }],
        ratio: typeof node.data?.ratio === "string" ? node.data.ratio : "Auto",
        resolution:
          typeof node.data?.resolution === "string"
            ? node.data.resolution
            : "1K",
      });

      if (!taskId) {
        throw new Error(UI_TEXT.enqueueFailed);
      }

      canvasStore.updateNodeData(nodeId, { prompt, placements: [] });
      return;
    }

    const plannerModelEntry =
      (typeof node.data?.plannerModel === "string" &&
        node.data.plannerModel.trim()) ||
      getPreferredSelectableModelEntryId(
        useSettingsStore.getState().config,
        "chat",
      ) ||
      "";
    const chatModel = resolveModelConfig(plannerModelEntry, "chat");
    if (!chatModel) {
      throw new Error(UI_TEXT.noChatModel);
    }

    let placements: Awaited<ReturnType<typeof planEntouragePlacements>>;
    try {
      placements = await planEntouragePlacements({
        imageUrl: sourceImageUrl,
        feature,
        model: chatModel,
      });
    } catch (error) {
      if (!source.assetRelativePath || !isPlanningImageReadFailure(error)) {
        throw error;
      }

      platformBridge.clearWorkspaceAssetUrlCache();
      sourceImageUrl = await resolveEntourageImageUrl(source, false);
      placements = await planEntouragePlacements({
        imageUrl: sourceImageUrl,
        feature,
        model: chatModel,
      });
    }
    if (placements.length === 0) {
      throw new Error(UI_TEXT.planningFailed);
    }
    canvasStore.updateNodeData(nodeId, { placements });

    let maskImageUrl = await createPlacementMaskDataUrl(
      sourceImageUrl,
      placements,
    );
    if (!maskImageUrl && source.assetRelativePath) {
      platformBridge.clearWorkspaceAssetUrlCache();
      sourceImageUrl = await resolveEntourageImageUrl(source, false);
      maskImageUrl = await createPlacementMaskDataUrl(
        sourceImageUrl,
        placements,
      );
    }
    if (!maskImageUrl) {
      throw new Error(UI_TEXT.maskFailed);
    }

    const prompt = buildEntourageEditPrompt(feature, placements);
    const taskId = enqueueEntourageEditTask({
      projectId: useProjectStore.getState().activeProjectId,
      nodeId,
      prompt,
      model: imageModel,
      sourceImageNodeId: source.sourceNodeId,
      maskImageUrl,
      editImageSource: { ...source, imageUrl: sourceImageUrl },
      maskImageSource: {
        sourceNodeId: null,
        imageUrl: maskImageUrl,
        assetRelativePath: null,
      },
      ratio: typeof node.data?.ratio === "string" ? node.data.ratio : "Auto",
      resolution:
        typeof node.data?.resolution === "string" ? node.data.resolution : "1K",
    });

    if (!taskId) {
      throw new Error(UI_TEXT.enqueueFailed);
    }

    canvasStore.updateNodeData(nodeId, {
      prompt,
      plannerModel: plannerModelEntry,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    canvasStore.updateNodeData(nodeId, {
      status: "error",
      errorMsg: message,
    });
  }
}
