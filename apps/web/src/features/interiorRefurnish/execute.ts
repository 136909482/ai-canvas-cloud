import { executeChatPrompt } from "@/api/chatAdapter";
import { enqueueInteriorRefurnishTask } from "@/features/generateQueue/orchestrator";
import { createInlinePlanningImage } from "@/features/entourage/planningImage";
import { resolveRuntimeModelConfig } from "@/features/settings/providerConfig";
import { platformBridge } from "@/platform";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { getWorkspaceAssetRelativePath } from "@/utils/workspaceImageAsset";
import type { GenerateTaskImageSource } from "@/types";
import {
  buildRefurnishPrompt,
  parseRecognizedParts,
  REFURNISH_RECOGNITION_SYSTEM_PROMPT,
} from "./runtime";

function getImageSource(nodeId: string | null) {
  if (!nodeId) return null;
  const node = useCanvasStore
    .getState()
    .nodes.find((candidate) => candidate.id === nodeId);
  const imageUrl =
    typeof node?.data?.imageUrl === "string" ? node.data.imageUrl : "";
  if (!node || !imageUrl) return null;
  return {
    sourceNodeId: node.id,
    imageUrl,
    assetRelativePath:
      getWorkspaceAssetRelativePath(node.data.imageAsset) ?? null,
  } satisfies GenerateTaskImageSource;
}

async function resolveSourceUrl(source: GenerateTaskImageSource) {
  if (!source.assetRelativePath) return source.imageUrl;
  return platformBridge.resolveWorkspaceAssetUrl(source.assetRelativePath);
}

function getRuntimeModel(modelEntryId: string, category: "chat" | "image") {
  const resolution = resolveRuntimeModelConfig(
    useSettingsStore.getState().config,
    { modelEntryId, category, requireCredentials: true },
  );
  if (!resolution.ok) throw new Error(resolution.diagnostic.message);
  return resolution.runtimeConfig;
}

export async function recognizeInteriorParts(nodeId: string) {
  const canvas = useCanvasStore.getState();
  const node = canvas.nodes.find(
    (candidate) =>
      candidate.id === nodeId && candidate.type === "interiorRefurnishNode",
  );
  if (!node) return;
  const scene = getImageSource(
    typeof node.data.sceneSourceNodeId === "string"
      ? node.data.sceneSourceNodeId
      : null,
  );
  if (!scene) {
    canvas.updateNodeData(nodeId, {
      recognitionStatus: "error",
      recognitionError: "请先连接一张室内场景图。",
    });
    return;
  }

  canvas.updateNodeData(nodeId, {
    recognitionStatus: "recognizing",
    recognitionError: "",
  });
  try {
    const recognitionModel =
      typeof node.data.recognitionModel === "string"
        ? node.data.recognitionModel
        : "";
    const model = getRuntimeModel(recognitionModel, "chat");
    const resolvedUrl = await resolveSourceUrl(scene);
    const inlineUrl = await createInlinePlanningImage(resolvedUrl);
    const response = await executeChatPrompt({
      model,
      systemPrompt: REFURNISH_RECOGNITION_SYSTEM_PROMPT,
      instructionPrompt: "识别这张室内图片中可替换的主要部件。",
      inputText: "",
      inputImageUrls: [inlineUrl],
      outputFormat: "json",
    });
    const parts = parseRecognizedParts(response);
    if (!parts.length)
      throw new Error("未识别到有效部件，可手工添加部件后继续。 ");
    useCanvasStore.getState().updateNodeData(nodeId, {
      recognizedParts: parts,
      recognitionStatus: "done",
      recognitionError: "",
    });
  } catch (error) {
    useCanvasStore.getState().updateNodeData(nodeId, {
      recognitionStatus: "error",
      recognitionError:
        error instanceof Error ? error.message.trim() : String(error),
    });
  }
}

export async function runInteriorRefurnish(nodeId: string) {
  const canvas = useCanvasStore.getState();
  const node = canvas.nodes.find(
    (candidate) =>
      candidate.id === nodeId && candidate.type === "interiorRefurnishNode",
  );
  if (!node) return;
  try {
    const scene = getImageSource(
      typeof node.data.sceneSourceNodeId === "string"
        ? node.data.sceneSourceNodeId
        : null,
    );
    if (!scene) throw new Error("请先连接一张室内场景图。");
    const bindings = Array.isArray(node.data.bindings)
      ? node.data.bindings
      : [];
    if (!bindings.length) throw new Error("请至少为一张商品图绑定替换部件。");
    const modelEntryId =
      typeof node.data.model === "string" ? node.data.model : "";
    getRuntimeModel(modelEntryId, "image");

    const sceneResolved = { ...scene, imageUrl: await resolveSourceUrl(scene) };
    const products: GenerateTaskImageSource[] = [];
    const validBindings: Array<{ sourceNodeId: string; partName: string }> = [];
    for (const binding of bindings.slice(0, 4)) {
      if (!binding || typeof binding !== "object") continue;
      const sourceNodeId =
        typeof binding.sourceNodeId === "string" ? binding.sourceNodeId : "";
      const partName =
        typeof binding.partName === "string" ? binding.partName.trim() : "";
      const source = getImageSource(sourceNodeId);
      if (!source || !partName) continue;
      products.push({ ...source, imageUrl: await resolveSourceUrl(source) });
      validBindings.push({ sourceNodeId, partName });
    }
    if (!validBindings.length)
      throw new Error("已绑定的商品图不可用，请重新连接。");
    const requirements =
      typeof node.data.requirements === "string" ? node.data.requirements : "";
    const prompt = buildRefurnishPrompt(validBindings, requirements);
    const taskId = enqueueInteriorRefurnishTask({
      projectId: useProjectStore.getState().activeProjectId,
      nodeId,
      prompt,
      model: modelEntryId,
      sourceImageNodeId: scene.sourceNodeId,
      referenceImages: [sceneResolved, ...products],
      resolution:
        typeof node.data.resolution === "string" ? node.data.resolution : "1K",
    });
    if (!taskId) throw new Error("无法创建换软装任务，请检查节点输入。 ");
    canvas.updateNodeData(nodeId, { prompt, errorMsg: "" });
  } catch (error) {
    canvas.updateNodeData(nodeId, {
      status: "error",
      errorMsg: error instanceof Error ? error.message.trim() : String(error),
    });
  }
}
