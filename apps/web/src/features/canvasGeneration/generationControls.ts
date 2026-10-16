import { isGptImageModel } from "@/api/imageAdapter";
import type { OfficialModelSummary } from "@ai-canvas-cloud/contracts";
import {
  normalizeGenerateOutputCount,
  normalizeGenerateRatio,
  normalizeGptImageBackground,
  type GenerateOutputCount,
} from "@/constants/generateNode";
import {
  isOfficialModelReference,
  parseModelSelectionRef,
} from "@/features/officialGeneration/modelReference";
import {
  compileImageMentionPrompt,
  hydrateRichPromptImageMentionUrls,
} from "@/features/richPrompt/promptCompiler";
import type {
  RichPromptDocument,
  RichPromptReferenceItem,
} from "@/features/richPrompt/types";
import {
  getNodeModelIssueLabel,
  type NodeModelSelection,
} from "@/features/settings/nodeModelSelection";
import { RESOLUTIONS } from "@/nodes/GenerateNode/modelSettings";
import type { ReferenceImageItem } from "@/nodes/GenerateNode/referenceImages";
import type { GenerateNodeData } from "@/types";
import { enqueueGenerateTask } from "@/features/generateQueue/orchestrator";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";

export function canConfigureGenerateQuality(
  selection: NodeModelSelection,
  officialModels: OfficialModelSummary[] = [],
) {
  const ref = parseModelSelectionRef(selection.reference);
  return ref.source === "official"
    ? officialModels.find((model) => model.id === ref.modelId)
        ?.parameterTemplate === "gpt-image"
    : isGptImageModel(selection.selectedModel?.modelId ?? "");
}

export function canConfigureGenerateBackground(
  selection: NodeModelSelection,
  officialModels: OfficialModelSummary[] = [],
) {
  return (
    canConfigureGenerateQuality(selection, officialModels) &&
    (isOfficialModelReference(selection.reference) ||
      selection.selectedProvider?.protocol === "openai-compatible")
  );
}

export function getGeneratePromptPatch(
  data: GenerateNodeData,
  richPrompt: RichPromptDocument,
  prompt: string,
) {
  if (data.connectedTextNode)
    return { promptSupplement: { prompt, richPrompt } };
  return { prompt, richPrompt };
}

export function buildGenerateSubmission({
  id,
  projectId,
  data,
  modelSelection,
  references,
  richPromptReferences,
  maskSource,
  officialModels = [],
}: {
  id: string;
  projectId: string | null;
  data: GenerateNodeData;
  modelSelection: NodeModelSelection;
  references: ReferenceImageItem[];
  richPromptReferences: RichPromptReferenceItem[];
  maskSource: ReferenceImageItem | null;
  officialModels?: OfficialModelSummary[];
}):
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      outputCount: GenerateOutputCount;
      patch: Partial<GenerateNodeData>;
      task: Parameters<typeof enqueueGenerateTask>[0];
    } {
  const prompt = data.prompt.trim();
  if (!prompt) return { kind: "empty" };
  const model = isOfficialModelReference(modelSelection.reference)
    ? modelSelection.reference
    : modelSelection.modelEntryId;
  if (!modelSelection.canExecute || !model)
    return {
      kind: "error",
      message:
        getNodeModelIssueLabel(modelSelection) ||
        "请选择可用的图像服务商和模型。",
    };
  const maskImage = data.maskInputEnabled ? maskSource : null;
  if (maskImage && references.length === 0)
    return { kind: "error", message: "使用蒙版重绘需要同时连接原图和蒙版" };
  const toTaskImage = (image: ReferenceImageItem) => ({
    sourceNodeId: image.sourceId,
    imageUrl: image.imageUrl,
    assetRelativePath: image.assetRelativePath ?? null,
  });
  const taskReferences = references.map(toTaskImage);
  return {
    kind: "ready",
    outputCount: normalizeGenerateOutputCount(data.outputCount),
    patch: {
      prompt,
      richPrompt: data.richPrompt ?? null,
      model: data.model.trim(),
    },
    task: {
      projectId,
      sourceNodeId: id,
      prompt: compileImageMentionPrompt({
        richPrompt: hydrateRichPromptImageMentionUrls(
          data.richPrompt,
          richPromptReferences,
        ),
        fallbackPrompt: prompt,
        references: richPromptReferences,
      }),
      negativePrompt: data.negativePrompt,
      model,
      ratio: normalizeGenerateRatio(data.ratio),
      resolution: RESOLUTIONS.includes(data.resolution)
        ? data.resolution
        : "1K",
      quality: canConfigureGenerateQuality(modelSelection, officialModels)
        ? data.quality || "auto"
        : null,
      ...(canConfigureGenerateBackground(modelSelection, officialModels)
        ? { background: normalizeGptImageBackground(data.background) }
        : {}),
      operationType: maskImage ? "image-edit" : undefined,
      sourceImageNodeId: maskImage ? (references[0]?.sourceId ?? null) : null,
      maskImageUrl: maskImage?.imageUrl ?? null,
      editImageSource: maskImage ? (taskReferences[0] ?? null) : null,
      maskImageSource: maskImage ? toTaskImage(maskImage) : null,
      referenceImages: maskImage ? taskReferences.slice(1) : taskReferences,
      googleSearch: false,
      googleImageSearch: false,
    },
  };
}

export function enqueueGenerateSubmission(
  submission: Extract<
    ReturnType<typeof buildGenerateSubmission>,
    { kind: "ready" }
  >,
) {
  const taskIds: string[] = [];
  for (let index = 0; index < submission.outputCount; index += 1) {
    const taskId = enqueueGenerateTask(submission.task);
    if (!taskId) break;
    const previewNodeId = useTaskQueueStore
      .getState()
      .tasks.find((task) => task.id === taskId)?.previewNodeId;
    if (previewNodeId)
      useCanvasStore.getState().updateNodeData(previewNodeId, {
        resultDisplay: submission.outputCount === 1 ? "inline" : "canvas",
      });
    taskIds.push(taskId);
  }
  return taskIds;
}
