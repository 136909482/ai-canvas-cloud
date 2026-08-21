import { resolveRuntimeModelConfig } from "@/features/settings/providerConfig";
import {
  makeSelectGenerateMaskSourceNode,
  makeSelectGenerateReferenceSourceNodes,
  useCanvasStore,
} from "@/store/useCanvasStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { getWorkspaceAssetRelativePath } from "@/utils/workspaceImageAsset";
import type {
  GenerateTask,
  GenerateTaskImageSource,
  GptImageQuality,
  ImageInputFidelity,
  ImageOperationType,
  VideoGenerateMode,
  VideoGenerateNodeData,
} from "@/types";
import { clearStagedGeneratedImageResult } from "./generatedAssets";
import {
  createProviderBindingFingerprint,
  resolveTaskAdapterId,
  resolveTaskExecutionMode,
} from "./imageProviderAdapters";
import {
  getActiveSourceTaskState,
  resolvePreviewSourceImageNodeId,
  syncPreviewNodeWithTask,
  syncSourceNodeAfterTaskSettles,
  syncSourceNodeWithTask,
  syncVideoNodeWithTask,
} from "./taskCanvasState";
import { canCancelQueuedTask } from "./taskQueueView";
import { canReuseTaskResultNode } from "./taskResultPolicy";

const UI_TEXT = {
  previewLabelPrefix: "\u9884\u89c8",
} as const;

type EnqueueGenerateTaskInput = {
  projectId?: string | null;
  sourceNodeId: string;
  prompt: string;
  negativePrompt?: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  operationType?: ImageOperationType;
  sourceImageNodeId?: string | null;
  maskImageUrl?: string | null;
  referenceImages?: GenerateTaskImageSource[];
  editImageSource?: GenerateTaskImageSource | null;
  maskImageSource?: GenerateTaskImageSource | null;
  inputFidelity?: ImageInputFidelity | null;
  quality?: GptImageQuality | null;
  googleSearch?: boolean;
  googleImageSearch?: boolean;
};

type EnqueueVideoGenerateTaskInput = {
  projectId?: string | null;
  sourceNodeId: string;
  prompt: string;
  model: string;
  mode: VideoGenerateMode;
  ratio: VideoGenerateNodeData["ratio"];
  resolution: VideoGenerateNodeData["resolution"];
  duration: VideoGenerateNodeData["duration"];
};

function createPreviewLabel(timestamp: number) {
  return `${UI_TEXT.previewLabelPrefix} ${new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false })}`;
}

function getImageSourceFromNode(
  node: ReturnType<typeof useCanvasStore.getState>["nodes"][number] | undefined,
) {
  const imageUrl =
    typeof node?.data?.imageUrl === "string" ? node.data.imageUrl : "";
  if (!node || !imageUrl) {
    return null;
  }

  return {
    sourceNodeId: node.id,
    imageUrl,
    assetRelativePath:
      getWorkspaceAssetRelativePath(node.data.imageAsset) ?? null,
  } satisfies GenerateTaskImageSource;
}

function enrichTaskImageSourcesFromCanvas(task: GenerateTask) {
  const taskReferenceImages = task.referenceImages;

  if (task.kind !== "image") {
    return {
      referenceImages: taskReferenceImages,
      editImageSource: task.editImageSource ?? null,
      maskImageSource: task.maskImageSource ?? null,
    };
  }

  const canvasState = useCanvasStore.getState();
  const referenceNodes = makeSelectGenerateReferenceSourceNodes(
    task.sourceNodeId,
  )(canvasState);
  const referenceImages = taskReferenceImages.map((source, index) => {
    if (source.assetRelativePath) {
      return source;
    }

    const sourceNode = source.sourceNodeId
      ? canvasState.nodes.find((node) => node.id === source.sourceNodeId)
      : referenceNodes[index];
    const currentSource = getImageSourceFromNode(sourceNode);
    return currentSource
      ? { ...source, ...currentSource, imageUrl: source.imageUrl }
      : source;
  });
  const editNode = task.sourceImageNodeId
    ? canvasState.nodes.find((node) => node.id === task.sourceImageNodeId)
    : undefined;
  const currentEditSource = getImageSourceFromNode(editNode);
  const maskNode = makeSelectGenerateMaskSourceNode(task.sourceNodeId)(
    canvasState,
  );
  const currentMaskSource = getImageSourceFromNode(maskNode ?? undefined);

  return {
    referenceImages,
    editImageSource:
      task.editImageSource?.assetRelativePath || !currentEditSource
        ? (task.editImageSource ?? null)
        : {
            ...(task.editImageSource ?? currentEditSource),
            sourceNodeId: currentEditSource.sourceNodeId,
            assetRelativePath: currentEditSource.assetRelativePath,
          },
    maskImageSource:
      task.maskImageSource?.assetRelativePath || !currentMaskSource
        ? (task.maskImageSource ?? null)
        : {
            ...(task.maskImageSource ?? currentMaskSource),
            sourceNodeId: currentMaskSource.sourceNodeId,
            assetRelativePath: currentMaskSource.assetRelativePath,
          },
  };
}

function getTaskProviderSnapshot(
  modelEntryId: string,
  category: "image" | "video",
): Pick<
  GenerateTask,
  | "apiProfileId"
  | "apiProfileName"
  | "provider"
  | "executionMode"
  | "adapterId"
  | "providerBindingFingerprint"
  | "providerManifestId"
  | "providerManifestVersion"
> {
  const settings = useSettingsStore.getState();
  const resolution = resolveRuntimeModelConfig(settings.config, {
    modelEntryId,
    category,
    requireCredentials: true,
  });

  if (!resolution.ok) {
    return {
      apiProfileId: null,
      apiProfileName: null,
      provider: null,
      executionMode: null,
      adapterId: null,
      providerBindingFingerprint: null,
      providerManifestId: null,
      providerManifestVersion: null,
    };
  }

  const adapterId = resolveTaskAdapterId(resolution.runtimeConfig, category);

  return {
    apiProfileId: resolution.profile.id,
    apiProfileName: resolution.profile.name,
    provider: resolution.runtimeConfig.provider,
    executionMode: resolveTaskExecutionMode(resolution.runtimeConfig, category),
    adapterId,
    providerBindingFingerprint: createProviderBindingFingerprint(
      resolution.runtimeConfig,
      resolution.profile.updatedAt,
      category,
    ),
    providerManifestId: resolution.runtimeConfig.customManifest?.id ?? null,
    providerManifestVersion:
      resolution.runtimeConfig.customManifest?.schemaVersion ?? null,
  };
}

function findReusablePreviewNode(
  sourceNodeId: string,
  reusableTaskId?: string,
) {
  const canvasStore = useCanvasStore.getState();
  const connectedPreviewNodes = canvasStore.edges
    .filter((edge) => edge.source === sourceNodeId)
    .map((edge) =>
      canvasStore.nodes.find(
        (node) =>
          node.id === edge.target && node.type === "generatedPreviewNode",
      ),
    )
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .filter((node) =>
      canReuseTaskResultNode(
        {
          hasResult: Boolean(node.data?.imageUrl),
          taskId: node.data?.taskId,
        },
        reusableTaskId,
      ),
    )
    .sort((left, right) => {
      const leftIsManualPreview =
        left.data?.sourceGenerateNodeId === "manual-preview";
      const rightIsManualPreview =
        right.data?.sourceGenerateNodeId === "manual-preview";

      if (leftIsManualPreview !== rightIsManualPreview) {
        return leftIsManualPreview ? -1 : 1;
      }

      const leftCreatedAt =
        typeof left.data?.createdAt === "number" ? left.data.createdAt : 0;
      const rightCreatedAt =
        typeof right.data?.createdAt === "number" ? right.data.createdAt : 0;
      return rightCreatedAt - leftCreatedAt;
    });

  return connectedPreviewNodes[0] ?? null;
}

function findReusableVideoNode(sourceNodeId: string, reusableTaskId?: string) {
  const canvasStore = useCanvasStore.getState();
  const connectedVideoNodes = canvasStore.edges
    .filter((edge) => edge.source === sourceNodeId)
    .map((edge) =>
      canvasStore.nodes.find(
        (node) => node.id === edge.target && node.type === "videoNode",
      ),
    )
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .filter((node) =>
      canReuseTaskResultNode(
        {
          hasResult: Boolean(node.data?.videoUrl),
          taskId: node.data?.taskId,
        },
        reusableTaskId,
      ),
    );

  return connectedVideoNodes[0] ?? null;
}

function createQueuedPreview(
  sourceNodeId: string,
  prompt: string,
  model: string,
  ratio: string,
  options?: {
    originOperation?: "generate" | "image-edit";
    sourceImageNodeId?: string | null;
    apiProfileName?: string | null;
    reusableTaskId?: string;
  },
) {
  const canvasStore = useCanvasStore.getState();
  const previewTimestamp = Date.now();
  const reusablePreviewNode = findReusablePreviewNode(
    sourceNodeId,
    options?.reusableTaskId,
  );
  const originOperation = options?.originOperation ?? "generate";
  const previewSourceImageNodeId = resolvePreviewSourceImageNodeId(
    options?.sourceImageNodeId ?? null,
  );

  if (reusablePreviewNode) {
    canvasStore.updateNodeData(reusablePreviewNode.id, {
      label: createPreviewLabel(previewTimestamp),
      prompt,
      model,
      apiProfileName: options?.apiProfileName ?? null,
      ratio,
      status: "queued",
      errorMsg: "",
      sourceGenerateNodeId: sourceNodeId,
      sourceImageNodeId: previewSourceImageNodeId,
      originOperation,
      taskId: null,
      createdAt: previewTimestamp,
    });

    return reusablePreviewNode.id;
  }

  return canvasStore.createGeneratedPreviewNode(sourceNodeId, {
    label: createPreviewLabel(previewTimestamp),
    prompt,
    imageUrl: "",
    model,
    apiProfileName: options?.apiProfileName ?? null,
    ratio,
    status: "queued",
    errorMsg: "",
    imageWidth: 0,
    imageHeight: 0,
    sourceImageNodeId: previewSourceImageNodeId,
    originOperation,
    taskId: null,
  });
}

function createQueuedVideoNode(sourceNodeId: string, reusableTaskId?: string) {
  const canvasStore = useCanvasStore.getState();
  const reusableVideoNode = findReusableVideoNode(sourceNodeId, reusableTaskId);

  if (reusableVideoNode) {
    canvasStore.updateNodeData(reusableVideoNode.id, {
      videoUrl: null,
      videoAsset: null,
      name: "视频生成中",
      duration: 0,
      videoWidth: 0,
      videoHeight: 0,
      status: "queued",
      errorMsg: "",
    });

    return reusableVideoNode.id;
  }

  return canvasStore.createGeneratedVideoNode(sourceNodeId, {
    videoUrl: null,
    videoAsset: null,
    name: "视频生成中",
    duration: 0,
    videoWidth: 0,
    videoHeight: 0,
    status: "queued",
    errorMsg: "",
  });
}

export function enqueueGenerateTask(input: EnqueueGenerateTaskInput) {
  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) => node.id === input.sourceNodeId && node.type === "generateNode",
  );

  if (!sourceNode) {
    return null;
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    return null;
  }

  const ratio = input.ratio || "1:1";
  const model = input.model?.trim() ?? "";
  if (!model) return null;
  const providerSnapshot = getTaskProviderSnapshot(model, "image");
  const sourceImageNodeId =
    typeof input.sourceImageNodeId === "string"
      ? input.sourceImageNodeId
      : null;
  const maskImageUrl = input.maskImageUrl ?? null;
  const referenceImages = input.referenceImages ?? [];
  const operationType =
    input.operationType === "image-edit" && sourceImageNodeId && maskImageUrl
      ? "image-edit"
      : referenceImages.length > 0
        ? "image-to-image"
        : "text-to-image";
  const previewNodeId = createQueuedPreview(
    input.sourceNodeId,
    prompt,
    model,
    ratio,
    {
      originOperation:
        operationType === "image-edit" ? "image-edit" : "generate",
      sourceImageNodeId:
        operationType === "image-edit" ? sourceImageNodeId : null,
      apiProfileName: providerSnapshot.apiProfileName,
    },
  );
  const taskId = useTaskQueueStore.getState().createTask({
    projectId: input.projectId ?? null,
    sourceNodeId: input.sourceNodeId,
    previewNodeId,
    model,
    prompt,
    negativePrompt: input.negativePrompt ?? "",
    ratio,
    resolution: input.resolution ?? "1K",
    operationType,
    sourceImageNodeId:
      operationType === "image-edit" ? sourceImageNodeId : null,
    maskImageUrl: operationType === "image-edit" ? maskImageUrl : null,
    editImageSource:
      operationType === "image-edit" ? (input.editImageSource ?? null) : null,
    maskImageSource:
      operationType === "image-edit" ? (input.maskImageSource ?? null) : null,
    ...providerSnapshot,
    referenceImages,
    inputFidelity: null,
    quality: input.quality ?? null,
    googleSearch: Boolean(input.googleSearch),
    googleImageSearch: Boolean(input.googleImageSearch),
  });

  const sourceTaskState = getActiveSourceTaskState(input.sourceNodeId);
  canvasStore.updateNodeData(input.sourceNodeId, {
    status: sourceTaskState?.status ?? "queued",
    errorMsg: sourceTaskState?.errorMsg ?? "",
    activeTaskId: sourceTaskState?.activeTaskId ?? taskId,
  });
  canvasStore.updateNodeData(previewNodeId, { taskId });

  return taskId;
}

export function enqueueEntourageEditTask(input: {
  projectId?: string | null;
  nodeId: string;
  prompt: string;
  model: string;
  sourceImageNodeId: string | null;
  maskImageUrl?: string | null;
  referenceImages?: GenerateTaskImageSource[];
  editImageSource?: GenerateTaskImageSource | null;
  maskImageSource?: GenerateTaskImageSource | null;
  ratio?: string;
  resolution?: string;
}) {
  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) => node.id === input.nodeId && node.type === "entourageNode",
  );

  if (!sourceNode) {
    return null;
  }

  const prompt = input.prompt.trim();
  const model = input.model?.trim() ?? "";
  if (!prompt || !model) {
    return null;
  }

  const ratio = input.ratio || "1:1";
  const sourceImageNodeId = input.sourceImageNodeId ?? null;
  const maskImageUrl = input.maskImageUrl ?? null;
  const referenceImages = input.referenceImages ?? [];
  const operationType =
    sourceImageNodeId && maskImageUrl
      ? "image-edit"
      : referenceImages.length > 0
        ? "image-to-image"
        : null;
  if (!sourceImageNodeId || !operationType) {
    return null;
  }

  const providerSnapshot = getTaskProviderSnapshot(model, "image");
  const previewNodeId = createQueuedPreview(
    input.nodeId,
    prompt,
    model,
    ratio,
    {
      originOperation:
        operationType === "image-edit" ? "image-edit" : "generate",
      sourceImageNodeId,
      apiProfileName: providerSnapshot.apiProfileName,
    },
  );
  const taskId = useTaskQueueStore.getState().createTask({
    projectId: input.projectId ?? null,
    sourceNodeId: input.nodeId,
    previewNodeId,
    model,
    prompt,
    negativePrompt: "",
    ratio,
    resolution: input.resolution ?? "1K",
    operationType,
    sourceImageNodeId,
    maskImageUrl: operationType === "image-edit" ? maskImageUrl : null,
    editImageSource:
      operationType === "image-edit" ? (input.editImageSource ?? null) : null,
    maskImageSource:
      operationType === "image-edit" ? (input.maskImageSource ?? null) : null,
    ...providerSnapshot,
    referenceImages: operationType === "image-to-image" ? referenceImages : [],
    inputFidelity: "high",
    quality: null,
    googleSearch: false,
    googleImageSearch: false,
  });

  const sourceTaskState = getActiveSourceTaskState(input.nodeId);
  canvasStore.updateNodeData(input.nodeId, {
    status: sourceTaskState?.status ?? "queued",
    errorMsg: sourceTaskState?.errorMsg ?? "",
    activeTaskId: sourceTaskState?.activeTaskId ?? taskId,
  });
  canvasStore.updateNodeData(previewNodeId, { taskId });

  return taskId;
}

export function enqueueInteriorRefurnishTask(input: {
  projectId?: string | null;
  nodeId: string;
  prompt: string;
  model: string;
  sourceImageNodeId: string;
  referenceImages: GenerateTaskImageSource[];
  resolution?: string;
}) {
  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) => node.id === input.nodeId && node.type === "interiorRefurnishNode",
  );
  const prompt = input.prompt.trim();
  const model = input.model.trim();
  if (!sourceNode || !prompt || !model || input.referenceImages.length < 2) {
    return null;
  }

  const providerSnapshot = getTaskProviderSnapshot(model, "image");
  const previewNodeId = createQueuedPreview(
    input.nodeId,
    prompt,
    model,
    "Auto",
    {
      originOperation: "generate",
      sourceImageNodeId: input.sourceImageNodeId,
      apiProfileName: providerSnapshot.apiProfileName,
    },
  );
  const taskId = useTaskQueueStore.getState().createTask({
    projectId: input.projectId ?? null,
    sourceNodeId: input.nodeId,
    previewNodeId,
    model,
    prompt,
    negativePrompt: "",
    ratio: "Auto",
    resolution: input.resolution ?? "1K",
    operationType: "image-to-image",
    sourceImageNodeId: input.sourceImageNodeId,
    ...providerSnapshot,
    referenceImages: input.referenceImages,
    inputFidelity: "high",
    quality: null,
    googleSearch: false,
    googleImageSearch: false,
  });

  const sourceTaskState = getActiveSourceTaskState(input.nodeId);
  canvasStore.updateNodeData(input.nodeId, {
    status: sourceTaskState?.status ?? "queued",
    errorMsg: sourceTaskState?.errorMsg ?? "",
    activeTaskId: sourceTaskState?.activeTaskId ?? taskId,
  });
  canvasStore.updateNodeData(previewNodeId, { taskId });
  return taskId;
}

export function enqueueVideoGenerateTask(input: EnqueueVideoGenerateTaskInput) {
  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) =>
      node.id === input.sourceNodeId && node.type === "videoGenerateNode",
  );

  if (!sourceNode) {
    return null;
  }

  const prompt = input.prompt.trim();
  const model = input.model?.trim() ?? "";
  if (!prompt || !model) {
    return null;
  }

  const videoNodeId = createQueuedVideoNode(input.sourceNodeId);
  const providerSnapshot = getTaskProviderSnapshot(model, "video");
  const taskId = useTaskQueueStore.getState().createTask({
    projectId: input.projectId ?? null,
    kind: "video",
    sourceNodeId: input.sourceNodeId,
    previewNodeId: videoNodeId,
    model,
    prompt,
    ratio: input.ratio,
    resolution: input.resolution,
    operationType: "text-to-image",
    ...providerSnapshot,
    referenceImages: [],
    videoMode: input.mode,
    videoDuration: input.duration,
  });

  const sourceTaskState = getActiveSourceTaskState(input.sourceNodeId);
  canvasStore.updateNodeData(input.sourceNodeId, {
    status: sourceTaskState?.status ?? "queued",
    errorMsg: sourceTaskState?.errorMsg ?? "",
  });
  canvasStore.updateNodeData(videoNodeId, {
    status: "queued",
    errorMsg: "",
    taskId,
  });

  return taskId;
}

export function enqueueImageEditTask(input: EnqueueGenerateTaskInput) {
  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) => node.id === input.sourceNodeId && node.type === "imageEditNode",
  );

  if (!sourceNode) {
    return null;
  }

  const prompt = input.prompt.trim();
  const sourceImageNodeId =
    typeof input.sourceImageNodeId === "string"
      ? input.sourceImageNodeId
      : typeof sourceNode.data?.sourceImageNodeId === "string"
        ? sourceNode.data.sourceImageNodeId
        : null;
  if (!prompt || !sourceImageNodeId) {
    return null;
  }

  const sourceImageNode = canvasStore.nodes.find(
    (node) => node.id === sourceImageNodeId,
  );
  const sourceImageUrl =
    typeof sourceImageNode?.data?.imageUrl === "string"
      ? sourceImageNode.data.imageUrl
      : "";
  if (!sourceImageUrl) {
    return null;
  }

  const ratio = input.ratio || "1:1";
  const model = input.model?.trim() ?? "";
  if (!model) return null;
  const providerSnapshot = getTaskProviderSnapshot(model, "image");
  const maskImageUrl =
    input.maskImageUrl ??
    (typeof sourceNode.data?.maskDataUrl === "string"
      ? sourceNode.data.maskDataUrl
      : null);
  if (!maskImageUrl) {
    return null;
  }

  const referenceImages = input.referenceImages ?? [];
  const previewNodeId = createQueuedPreview(
    input.sourceNodeId,
    prompt,
    model,
    ratio,
    {
      originOperation: "image-edit",
      sourceImageNodeId,
      apiProfileName: providerSnapshot.apiProfileName,
    },
  );
  const taskId = useTaskQueueStore.getState().createTask({
    projectId: input.projectId ?? null,
    sourceNodeId: input.sourceNodeId,
    previewNodeId,
    model,
    prompt,
    negativePrompt: input.negativePrompt ?? "",
    ratio,
    resolution: input.resolution ?? "1K",
    operationType: "image-edit",
    sourceImageNodeId,
    maskImageUrl,
    editImageSource: input.editImageSource ?? {
      sourceNodeId: sourceImageNodeId,
      imageUrl: sourceImageUrl,
      assetRelativePath:
        getWorkspaceAssetRelativePath(sourceImageNode?.data?.imageAsset) ??
        null,
    },
    maskImageSource: input.maskImageSource ?? {
      sourceNodeId: null,
      imageUrl: maskImageUrl,
      assetRelativePath: null,
    },
    ...providerSnapshot,
    referenceImages,
    inputFidelity: null,
    quality: input.quality ?? null,
    googleSearch: Boolean(input.googleSearch),
    googleImageSearch: Boolean(input.googleImageSearch),
  });

  const sourceTaskState = getActiveSourceTaskState(input.sourceNodeId);
  canvasStore.updateNodeData(input.sourceNodeId, {
    status: sourceTaskState?.status ?? "queued",
    errorMsg: sourceTaskState?.errorMsg ?? "",
    model,
    sourceImageNodeId,
    maskDataUrl: maskImageUrl,
    activeTaskId: sourceTaskState?.activeTaskId ?? taskId,
  });
  canvasStore.updateNodeData(previewNodeId, { taskId });

  return taskId;
}

export function retryGenerateTask(taskId: string) {
  const taskStore = useTaskQueueStore.getState();
  const task = taskStore.tasks.find((item) => item.id === taskId);

  if (!task) {
    return null;
  }

  if (task.kind === "image" && task.phase === "persisting") {
    taskStore.resumePersistingTask(taskId);
    syncSourceNodeWithTask(task, "queued");
    syncPreviewNodeWithTask(task, "queued");
    return taskId;
  }

  const providerSnapshot = getTaskProviderSnapshot(task.model, task.kind);
  const refreshedImageSources = enrichTaskImageSourcesFromCanvas(task);
  const bindingChanged =
    Boolean(task.providerBindingFingerprint) &&
    task.providerBindingFingerprint !==
      providerSnapshot.providerBindingFingerprint;

  if (
    task.remoteTaskId &&
    !bindingChanged &&
    (task.kind === "video" || task.kind === "image")
  ) {
    taskStore.queueRemoteTask(taskId);
    const runningTask = useTaskQueueStore
      .getState()
      .tasks.find((item) => item.id === taskId);

    if (!runningTask) {
      return null;
    }

    syncSourceNodeWithTask(runningTask, "queued");
    if (runningTask.kind === "video") {
      syncVideoNodeWithTask(runningTask, "queued");
    } else {
      syncPreviewNodeWithTask(runningTask, "queued");
    }

    return taskId;
  }

  const previewNodeId =
    task.kind === "video"
      ? createQueuedVideoNode(task.sourceNodeId, task.id)
      : createQueuedPreview(
          task.sourceNodeId,
          task.prompt,
          task.model,
          task.ratio,
          {
            originOperation:
              task.operationType === "image-edit" ? "image-edit" : "generate",
            sourceImageNodeId: task.sourceImageNodeId,
            apiProfileName: task.apiProfileName,
            reusableTaskId: task.id,
          },
        );

  taskStore.markTaskQueued(taskId, {
    kind: task.kind,
    sourceNodeId: task.sourceNodeId,
    previewNodeId,
    model: task.model,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    ratio: task.ratio,
    resolution: task.resolution,
    operationType: task.operationType,
    sourceImageNodeId: task.sourceImageNodeId,
    maskImageUrl: task.maskImageUrl ?? null,
    ...refreshedImageSources,
    inputFidelity: task.inputFidelity ?? null,
    quality: task.quality ?? null,
    googleSearch: Boolean(task.googleSearch),
    googleImageSearch: Boolean(task.googleImageSearch),
    videoMode: task.videoMode ?? null,
    videoDuration: task.videoDuration ?? null,
    ...providerSnapshot,
  });

  const nextTask = useTaskQueueStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  if (!nextTask) {
    return null;
  }

  const sourceTaskState = getActiveSourceTaskState(nextTask.sourceNodeId);
  useCanvasStore.getState().updateNodeData(nextTask.sourceNodeId, {
    status: sourceTaskState?.status ?? "queued",
    errorMsg: sourceTaskState?.errorMsg ?? "",
    ...(nextTask.kind === "image"
      ? { activeTaskId: sourceTaskState?.activeTaskId ?? nextTask.id }
      : {}),
  });
  if (nextTask.kind === "video") {
    syncVideoNodeWithTask(nextTask, "queued");
  } else {
    syncPreviewNodeWithTask(nextTask, "queued");
  }

  return taskId;
}

function syncSourceNodeAfterTaskRemoval(task: GenerateTask) {
  const activeState = getActiveSourceTaskState(task.sourceNodeId);
  if (activeState) {
    useCanvasStore.getState().updateNodeData(task.sourceNodeId, activeState);
    return;
  }

  const remainingTask = useTaskQueueStore
    .getState()
    .tasks.filter((candidate) => candidate.sourceNodeId === task.sourceNodeId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  if (remainingTask) {
    syncSourceNodeAfterTaskSettles(remainingTask, {
      status: remainingTask.status === "error" ? "error" : "done",
      errorMsg: remainingTask.errorMsg,
    });
    return;
  }

  useCanvasStore.getState().updateNodeData(task.sourceNodeId, {
    status: "idle",
    errorMsg: "",
    activeTaskId: null,
  });
}

export function cancelQueuedGenerateTask(taskId: string) {
  const taskStore = useTaskQueueStore.getState();
  const task = taskStore.tasks.find((candidate) => candidate.id === taskId);
  if (!task || !canCancelQueuedTask(task)) return false;

  taskStore.removeTask(task.id);
  if (task.previewNodeId) {
    const previewNode = useCanvasStore
      .getState()
      .nodes.find((node) => node.id === task.previewNodeId);
    const hasResult = Boolean(
      previewNode?.data?.imageUrl || previewNode?.data?.videoUrl,
    );
    if (!hasResult) useCanvasStore.getState().deleteNode(task.previewNodeId);
  }
  void clearStagedGeneratedImageResult(task);
  syncSourceNodeAfterTaskRemoval(task);
  return true;
}

export async function removeGenerateTask(taskId: string) {
  const taskStore = useTaskQueueStore.getState();
  const task = taskStore.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.status === "queued" || task.status === "running") {
    return false;
  }

  if (task.kind === "image") await clearStagedGeneratedImageResult(task);
  taskStore.removeTask(task.id);
  syncSourceNodeAfterTaskRemoval(task);
  return true;
}

export async function clearFinishedGenerateTasks() {
  const taskStore = useTaskQueueStore.getState();
  const finishedTasks = taskStore.tasks.filter(
    (task) => task.status === "done" || task.status === "error",
  );
  await Promise.all(
    finishedTasks
      .filter((task) => task.kind === "image")
      .map((task) => clearStagedGeneratedImageResult(task)),
  );
  taskStore.clearFinishedTasks();
}
