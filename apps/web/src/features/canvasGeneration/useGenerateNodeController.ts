import { useEffect, useMemo, useRef, type SyntheticEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  MAX_GENERATE_REFERENCE_IMAGES,
  normalizeGenerateOutputCount,
  normalizeGenerateRatio,
  normalizeGptImageBackground,
} from "@/constants/generateNode";
import type {
  RichPromptDocument,
  RichPromptReferenceItem,
} from "@/features/richPrompt/types";
import { useOfficialGenerationRuntime } from "@/features/officialGeneration/runtime";
import { getOfficialModelCreditCost } from "@/features/officialGeneration/modelPricing";
import {
  isOfficialModelReference,
  parseModelSelectionRef,
} from "@/features/officialGeneration/modelReference";
import {
  getNodeModelIssueLabel,
  getNodeModelSelection,
} from "@/features/settings/nodeModelSelection";
import {
  makeSelectGenerateMaskSourceNode,
  makeSelectGenerateReferenceSourceNodes,
  useCanvasStore,
} from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { getGenerateTextSource } from "@/store/canvasConnectionSources";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import type { GenerateNodeData } from "@/types";
import {
  getWorkspaceAssetRelativePath,
  getWorkspaceAssetThumbnailRelativePath,
} from "@/utils/workspaceImageAsset";
import {
  decodeReferenceImageKey,
  encodeReferenceImageKey,
  type ReferenceImageItem,
} from "@/nodes/GenerateNode/referenceImages";
import {
  RESOLUTIONS,
  getGenerateSettingsSummary,
  hasPromptRatio,
  shouldShowResolutionSettings,
} from "@/nodes/GenerateNode/modelSettings";
import {
  buildGenerateSubmission,
  canConfigureGenerateBackground,
  canConfigureGenerateQuality,
  enqueueGenerateSubmission,
  getGeneratePromptPatch,
} from "./generationControls";
import { getGenerateEditablePrompt } from "./generatePrompt";

export function useGenerateNodeController({
  id,
  data,
}: {
  id: string;
  data: GenerateNodeData;
}) {
  const officialRuntime = useOfficialGenerationRuntime();
  const settingsConfig = useSettingsStore((state) => state.config);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const beginTransaction = useHistoryStore((state) => state.beginTransaction);
  const commitTransaction = useHistoryStore((state) => state.commitTransaction);
  const runTracked = useHistoryStore((state) => state.runTracked);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteReferenceEdges = useCanvasStore(
    (state) => state.deleteEdgesBySourceTargetExceptHandle,
  );
  const deleteMaskEdges = useCanvasStore(
    (state) => state.deleteEdgesBySourceTargetHandle,
  );
  const setDefaultModel = useSettingsStore((state) => state.setDefaultModel);
  const bindLocalModelReference = useSettingsStore(
    (state) => state.bindLocalModelReference,
  );
  const editingPrompt = useRef(false);

  const selectReferenceImageKeys = useMemo(() => {
    const selectSources = makeSelectGenerateReferenceSourceNodes(id);
    return (state: Parameters<typeof selectSources>[0]) =>
      selectSources(state).map((node) =>
        encodeReferenceImageKey({
          sourceId: node.id,
          imageUrl: node.data.imageUrl as string,
          thumbnailRelativePath: getWorkspaceAssetThumbnailRelativePath(
            node.data.imageAsset,
          ),
          assetRelativePath: getWorkspaceAssetRelativePath(
            node.data.imageAsset,
          ),
        }),
      );
  }, [id]);
  const selectMaskImageKey = useMemo(() => {
    const selectSource = makeSelectGenerateMaskSourceNode(id);
    return (state: Parameters<typeof selectSource>[0]) => {
      const node = selectSource(state);
      return node
        ? encodeReferenceImageKey({
            sourceId: node.id,
            imageUrl: node.data.imageUrl as string,
            thumbnailRelativePath: getWorkspaceAssetThumbnailRelativePath(
              node.data.imageAsset,
            ),
            assetRelativePath: getWorkspaceAssetRelativePath(
              node.data.imageAsset,
            ),
          })
        : "";
    };
  }, [id]);
  const referenceImageKeys = useCanvasStore(
    useShallow(selectReferenceImageKeys),
  );
  const maskImageKey = useCanvasStore(selectMaskImageKey);
  const connectedText = useCanvasStore(
    useShallow((state) => getGenerateTextSource(state.nodes, state.edges, id)),
  );
  const activeTaskCount = useTaskQueueStore(
    (state) =>
      state.tasks.filter(
        (task) =>
          task.sourceNodeId === id &&
          (task.status === "queued" || task.status === "running"),
      ).length,
  );
  const allReferenceImages = useMemo(
    () =>
      referenceImageKeys
        .map(decodeReferenceImageKey)
        .filter((item): item is ReferenceImageItem => Boolean(item)),
    [referenceImageKeys],
  );
  const maskSourceImage = useMemo(
    () => (maskImageKey ? decodeReferenceImageKey(maskImageKey) : null),
    [maskImageKey],
  );
  const referenceImages = useMemo(
    () => allReferenceImages.slice(0, MAX_GENERATE_REFERENCE_IMAGES),
    [allReferenceImages],
  );
  const richPromptReferences = useMemo<RichPromptReferenceItem[]>(
    () =>
      referenceImages.map((item, index) => ({
        sourceId: item.sourceId,
        imageUrl: item.imageUrl,
        thumbnailRelativePath: item.thumbnailRelativePath,
        label: `图片${index + 1}`,
        order: index + 1,
      })),
    [referenceImages],
  );
  const isConnected = Boolean(data.connectedTextNode);
  const editablePrompt = getGenerateEditablePrompt(data);
  const maskInputEnabled = data.maskInputEnabled === true;
  const referenceImageCount = referenceImages.length;
  const maskImageUrl =
    maskInputEnabled && maskSourceImage ? maskSourceImage.imageUrl : "";
  const hasMaskImage = Boolean(maskImageUrl);
  const modelSelection = useMemo(
    () =>
      getNodeModelSelection(settingsConfig, {
        category: "image",
        reference: data.model,
        officialGenerationEnabled:
          officialRuntime.preferences?.effectiveEnabled,
      }),
    [data.model, officialRuntime.preferences?.effectiveEnabled, settingsConfig],
  );
  const modelIssueLabel = getNodeModelIssueLabel(modelSelection);
  const officialReference = parseModelSelectionRef(modelSelection.reference);
  const modelLabel =
    modelSelection.selectedModel?.displayName ||
    modelSelection.selectedModel?.modelId ||
    (officialReference.source === "official"
      ? officialRuntime.models.find(
          (model) => model.id === officialReference.modelId,
        )?.name
      : null) ||
    "未选择模型";
  const isGptImageSettingsModel = canConfigureGenerateQuality(
    modelSelection,
    officialRuntime.models,
  );
  const ratio = normalizeGenerateRatio(data.ratio);
  const resolution = RESOLUTIONS.includes(data.resolution)
    ? data.resolution
    : "1K";
  const quality = data.quality || "auto";
  const outputCount = normalizeGenerateOutputCount(data.outputCount);
  const background = normalizeGptImageBackground(data.background);
  const showBackgroundSettings = canConfigureGenerateBackground(
    modelSelection,
    officialRuntime.models,
  );
  const creditCost = getOfficialModelCreditCost(
    modelSelection.reference,
    resolution,
    officialRuntime.preferences?.effectiveEnabled ? officialRuntime.models : [],
    outputCount,
  );
  const hasAutoRatioSource =
    referenceImageCount > 0 ||
    hasMaskImage ||
    hasPromptRatio(data.prompt || "");
  const settingsSummary = getGenerateSettingsSummary({
    isGptImageModel: isGptImageSettingsModel,
    ratio,
    resolution,
    quality,
    hasAutoRatioSource,
    outputCount,
    background,
    showBackgroundSettings,
  });
  const showResolutionSettings = shouldShowResolutionSettings(
    isGptImageSettingsModel,
    ratio,
    hasAutoRatioSource,
  );
  const isQueued = data.status === "queued";
  const isGenerating = data.status === "generating";
  const hasPrompt = Boolean((data.prompt || "").trim());

  useEffect(
    () => () => {
      if (editingPrompt.current) commitTransaction();
    },
    [commitTransaction],
  );
  const beginPromptTransaction = () => {
    editingPrompt.current = true;
    beginTransaction();
  };
  const handlePromptBlur = () => {
    if (!editingPrompt.current) return;
    editingPrompt.current = false;
    commitTransaction();
  };
  const handlePromptChange = (
    richPrompt: RichPromptDocument,
    prompt: string,
  ) => {
    const patch = getGeneratePromptPatch(data, richPrompt, prompt);
    updateNodeData(id, patch);
  };
  const selectModel = (modelId: string) =>
    runTracked(() => {
      if (
        !isOfficialModelReference(modelId) &&
        modelSelection.issue === "unbound" &&
        modelId !== data.model &&
        !bindLocalModelReference(data.model, modelId)
      )
        return;
      updateNodeData(id, { model: modelId, errorMsg: "" });
      if (modelId && !isOfficialModelReference(modelId))
        setDefaultModel(modelId);
    });
  const updateGenerationSettings = (patch: Record<string, unknown>) =>
    runTracked(() => updateNodeData(id, patch));
  const toggleMaskInput = () =>
    runTracked(() => {
      const next = !maskInputEnabled;
      if (!next && maskSourceImage)
        deleteMaskEdges(maskSourceImage.sourceId, id, "mask");
      updateNodeData(id, {
        maskInputEnabled: next,
        ...(!next ? { maskSourceNodeId: null } : {}),
      });
    });
  const removeReference = (sourceId: string) =>
    runTracked(() => deleteReferenceEdges(sourceId, id, "mask"));
  const removeTextReference = () => {
    if (connectedText.sourceId) removeReference(connectedText.sourceId);
  };
  const removeMask = () => {
    if (maskSourceImage)
      runTracked(() => deleteMaskEdges(maskSourceImage.sourceId, id, "mask"));
  };
  const enqueue = () => {
    if (
      !useCanvasStore
        .getState()
        .nodes.some((node) => node.id === id && node.type === "generateNode")
    )
      return;
    const submission = buildGenerateSubmission({
      id,
      projectId: activeProjectId,
      data,
      modelSelection,
      references: referenceImages,
      richPromptReferences,
      maskSource: maskSourceImage,
      officialModels: officialRuntime.models,
    });
    if (submission.kind === "empty") return;
    if (submission.kind === "error") {
      updateNodeData(id, { status: "error", errorMsg: submission.message });
      return;
    }
    updateNodeData(id, submission.patch);
    enqueueGenerateSubmission(submission);
  };
  return {
    data,
    settingsConfig,
    referenceImages,
    richPromptReferences,
    maskSourceImage,
    maskImageUrl,
    maskInputEnabled,
    referenceImageCount,
    hasReferenceLimit:
      allReferenceImages.length >= MAX_GENERATE_REFERENCE_IMAGES,
    isConnected,
    connectedText,
    editablePrompt,
    hasPrompt,
    modelSelection,
    modelIssueLabel,
    modelLabel,
    isGptImageSettingsModel,
    ratio,
    resolution,
    quality,
    outputCount,
    background,
    showBackgroundSettings,
    settingsSummary,
    creditCost,
    showResolutionSettings,
    activeTaskCount,
    isQueued,
    isGenerating,
    isBusy: isQueued || isGenerating,
    beginPromptTransaction,
    handlePromptChange,
    handlePromptBlur,
    selectModel,
    updateGenerationSettings,
    toggleMaskInput,
    removeReference,
    removeTextReference,
    removeMask,
    enqueue,
    stopCanvasGesture: (event: SyntheticEvent) => event.stopPropagation(),
  };
}

export type GenerateNodeController = ReturnType<
  typeof useGenerateNodeController
>;
