import type {
  GenerateTask,
  GenerateTaskAdapterId,
  GenerateTaskExecutionMode,
  GenerateTaskImageSource,
  GenerateTaskPhase,
  GptImageQuality,
  ImageInputFidelity,
  ImageOperationType,
  VideoGenerateMode,
  VideoGenerateNodeData,
} from "@/types";

export interface GenerateTaskSnapshot {
  projectId?: string | null;
  kind?: "image" | "video";
  sourceNodeId: string;
  previewNodeId?: string | null;
  model: string;
  prompt: string;
  negativePrompt?: string;
  ratio?: string;
  resolution?: string;
  operationType?: ImageOperationType;
  sourceImageNodeId?: string | null;
  maskImageUrl?: string | null;
  apiProfileId?: string | null;
  apiProfileName?: string | null;
  provider?: string | null;
  referenceImages?: GenerateTaskImageSource[];
  editImageSource?: GenerateTaskImageSource | null;
  maskImageSource?: GenerateTaskImageSource | null;
  inputFidelity?: ImageInputFidelity | null;
  quality?: GptImageQuality | null;
  googleSearch?: boolean;
  googleImageSearch?: boolean;
  videoMode?: VideoGenerateMode | null;
  videoDuration?: VideoGenerateNodeData["duration"] | null;
  resultImageAsset?: GenerateTask["resultImageAsset"];
  resultVideoAsset?: GenerateTask["resultVideoAsset"];
  telemetryAttemptId?: string | null;
  telemetryStartedAt?: number | null;
  phase?: GenerateTaskPhase | null;
  executionMode?: GenerateTaskExecutionMode | null;
  adapterId?: GenerateTaskAdapterId | null;
  providerBindingFingerprint?: string | null;
  providerManifestId?: string | null;
  providerManifestVersion?: 1 | null;
}

const INTERRUPTED_LOCAL_TASK_MESSAGE =
  "\u9875\u9762\u5173\u95ed\u6216\u5237\u65b0\u540e\uff0c\u540c\u6b65\u4efb\u52a1\u5df2\u4e2d\u65ad\uff0c\u8bf7\u624b\u52a8\u91cd\u8bd5\u3002";

function sanitizeImageSource(value: unknown): GenerateTaskImageSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Partial<GenerateTaskImageSource>;
  const imageUrl = typeof source.imageUrl === "string" ? source.imageUrl : "";
  const assetRelativePath =
    typeof source.assetRelativePath === "string" && source.assetRelativePath
      ? source.assetRelativePath
      : null;
  if (!imageUrl && !assetRelativePath) {
    return null;
  }

  return {
    sourceNodeId:
      typeof source.sourceNodeId === "string" ? source.sourceNodeId : null,
    imageUrl,
    assetRelativePath,
  };
}

function sanitizeReferenceImages(task: GenerateTask) {
  return Array.isArray(task.referenceImages)
    ? task.referenceImages
        .map(sanitizeImageSource)
        .filter((source): source is GenerateTaskImageSource => Boolean(source))
    : [];
}

export function createTaskDisplayId(seed: string) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

function sanitizeTask(
  task: GenerateTask,
  projectId?: string | null,
): GenerateTask {
  const referenceImages = sanitizeReferenceImages(task);
  return {
    ...task,
    projectId: projectId ?? task.projectId ?? null,
    kind: task.kind === "video" ? "video" : "image",
    displayId:
      typeof task.displayId === "string" && task.displayId.trim()
        ? task.displayId
        : createTaskDisplayId(`${task.id}:${task.createdAt}:${task.prompt}`),
    previewNodeId: task.previewNodeId ?? null,
    negativePrompt: task.negativePrompt ?? "",
    ratio: task.ratio ?? "1:1",
    resolution: task.resolution ?? "1K",
    operationType:
      task.operationType ??
      (referenceImages.length ? "image-to-image" : "text-to-image"),
    sourceImageNodeId: task.sourceImageNodeId ?? null,
    maskImageUrl: task.maskImageUrl ?? null,
    apiProfileId: task.apiProfileId ?? null,
    apiProfileName: task.apiProfileName ?? null,
    provider: task.provider ?? null,
    referenceImages,
    editImageSource: sanitizeImageSource(task.editImageSource),
    maskImageSource: sanitizeImageSource(task.maskImageSource),
    inputFidelity: task.inputFidelity ?? null,
    quality: task.quality ?? null,
    googleSearch: Boolean(task.googleSearch),
    googleImageSearch: Boolean(task.googleImageSearch),
    videoMode: task.videoMode ?? null,
    videoDuration: task.videoDuration ?? null,
    resultImageAsset: task.resultImageAsset ?? null,
    resultVideoAsset: task.resultVideoAsset ?? null,
    errorMsg: task.errorMsg ?? "",
    remoteTaskId: task.remoteTaskId ?? null,
    remoteStatus: task.remoteStatus ?? null,
    phase: task.phase ?? null,
    executionMode: task.executionMode ?? null,
    adapterId: task.adapterId ?? null,
    providerBindingFingerprint: task.providerBindingFingerprint ?? null,
    providerManifestId: task.providerManifestId ?? null,
    providerManifestVersion: task.providerManifestVersion === 1 ? 1 : null,
    telemetryAttemptId: task.telemetryAttemptId ?? null,
    telemetryStartedAt: task.telemetryStartedAt ?? null,
    finishedAt: task.finishedAt ?? null,
  };
}

export function sanitizeTasks(
  tasks: GenerateTask[],
  projectId?: string | null,
): GenerateTask[] {
  return tasks.map((task) => sanitizeTask(task, projectId));
}

function stripAssetBackedRuntimeUrl(
  source: GenerateTaskImageSource | null | undefined,
) {
  return source?.assetRelativePath ? { ...source, imageUrl: "" } : source;
}

export function prepareTasksForSnapshot(tasks: GenerateTask[]) {
  return sanitizeTasks(tasks).map((task) => {
    const referenceImages = task.referenceImages.map(
      (source) => stripAssetBackedRuntimeUrl(source) ?? source,
    );

    return {
      ...task,
      referenceImages,
      editImageSource: stripAssetBackedRuntimeUrl(task.editImageSource),
      maskImageSource: stripAssetBackedRuntimeUrl(task.maskImageSource),
    };
  });
}

export function recoverTaskAfterSnapshotLoad(
  task: GenerateTask,
  projectId?: string | null,
): GenerateTask {
  const sanitizedTask = sanitizeTask(task, projectId);

  if (
    sanitizedTask.kind === "image" &&
    sanitizedTask.phase === "persisting" &&
    (sanitizedTask.status === "queued" ||
      sanitizedTask.status === "running" ||
      sanitizedTask.status === "error")
  ) {
    return {
      ...sanitizedTask,
      status: "queued",
      errorMsg: "",
      startedAt: 0,
      finishedAt: null,
    };
  }

  if (sanitizedTask.status === "running" && sanitizedTask.remoteTaskId) {
    return {
      ...sanitizedTask,
      status: "queued",
      errorMsg: "",
      phase: "polling",
      remoteStatus: "IN_PROGRESS",
      startedAt: 0,
      finishedAt: null,
    };
  }

  if (sanitizedTask.status === "running") {
    return {
      ...sanitizedTask,
      status: "error",
      phase: "requesting",
      errorMsg: INTERRUPTED_LOCAL_TASK_MESSAGE,
      remoteTaskId: null,
      remoteStatus: null,
      finishedAt: Date.now(),
    };
  }

  if (sanitizedTask.status === "queued") {
    return {
      ...sanitizedTask,
      errorMsg: "",
      phase: null,
      remoteTaskId: null,
      remoteStatus: null,
      startedAt: 0,
      finishedAt: null,
    };
  }

  return sanitizedTask;
}

export function recoverTasksAfterSnapshotLoad(
  tasks: GenerateTask[],
  projectId?: string | null,
): GenerateTask[] {
  return tasks.map((task) => recoverTaskAfterSnapshotLoad(task, projectId));
}

export function mergeTaskSnapshot(
  task: GenerateTask,
  patch?: Partial<GenerateTaskSnapshot>,
): GenerateTask {
  return {
    ...task,
    projectId:
      patch && "projectId" in patch
        ? (patch.projectId ?? null)
        : (task.projectId ?? null),
    kind: patch?.kind ?? task.kind,
    sourceNodeId: patch?.sourceNodeId ?? task.sourceNodeId,
    previewNodeId:
      patch && "previewNodeId" in patch
        ? (patch.previewNodeId ?? null)
        : task.previewNodeId,
    model: patch?.model ?? task.model,
    prompt: patch?.prompt ?? task.prompt,
    negativePrompt: patch?.negativePrompt ?? task.negativePrompt,
    ratio: patch?.ratio ?? task.ratio,
    resolution: patch?.resolution ?? task.resolution,
    operationType: patch?.operationType ?? task.operationType,
    sourceImageNodeId:
      patch && "sourceImageNodeId" in patch
        ? (patch.sourceImageNodeId ?? null)
        : task.sourceImageNodeId,
    maskImageUrl:
      patch && "maskImageUrl" in patch
        ? (patch.maskImageUrl ?? null)
        : (task.maskImageUrl ?? null),
    apiProfileId:
      patch && "apiProfileId" in patch
        ? (patch.apiProfileId ?? null)
        : (task.apiProfileId ?? null),
    apiProfileName:
      patch && "apiProfileName" in patch
        ? (patch.apiProfileName ?? null)
        : (task.apiProfileName ?? null),
    provider:
      patch && "provider" in patch
        ? (patch.provider ?? null)
        : (task.provider ?? null),
    referenceImages: patch?.referenceImages ?? task.referenceImages,
    editImageSource:
      patch && "editImageSource" in patch
        ? (patch.editImageSource ?? null)
        : (task.editImageSource ?? null),
    maskImageSource:
      patch && "maskImageSource" in patch
        ? (patch.maskImageSource ?? null)
        : (task.maskImageSource ?? null),
    inputFidelity:
      patch && "inputFidelity" in patch
        ? (patch.inputFidelity ?? null)
        : (task.inputFidelity ?? null),
    quality:
      patch && "quality" in patch
        ? (patch.quality ?? null)
        : (task.quality ?? null),
    googleSearch:
      patch && "googleSearch" in patch
        ? Boolean(patch.googleSearch)
        : Boolean(task.googleSearch),
    googleImageSearch:
      patch && "googleImageSearch" in patch
        ? Boolean(patch.googleImageSearch)
        : Boolean(task.googleImageSearch),
    videoMode:
      patch && "videoMode" in patch
        ? (patch.videoMode ?? null)
        : (task.videoMode ?? null),
    videoDuration:
      patch && "videoDuration" in patch
        ? (patch.videoDuration ?? null)
        : (task.videoDuration ?? null),
    resultImageAsset:
      patch && "resultImageAsset" in patch
        ? (patch.resultImageAsset ?? null)
        : (task.resultImageAsset ?? null),
    resultVideoAsset:
      patch && "resultVideoAsset" in patch
        ? (patch.resultVideoAsset ?? null)
        : (task.resultVideoAsset ?? null),
    telemetryAttemptId:
      patch && "telemetryAttemptId" in patch
        ? (patch.telemetryAttemptId ?? null)
        : (task.telemetryAttemptId ?? null),
    telemetryStartedAt:
      patch && "telemetryStartedAt" in patch
        ? (patch.telemetryStartedAt ?? null)
        : (task.telemetryStartedAt ?? null),
    phase:
      patch && "phase" in patch ? (patch.phase ?? null) : (task.phase ?? null),
    executionMode:
      patch && "executionMode" in patch
        ? (patch.executionMode ?? null)
        : (task.executionMode ?? null),
    adapterId:
      patch && "adapterId" in patch
        ? (patch.adapterId ?? null)
        : (task.adapterId ?? null),
    providerBindingFingerprint:
      patch && "providerBindingFingerprint" in patch
        ? (patch.providerBindingFingerprint ?? null)
        : (task.providerBindingFingerprint ?? null),
    providerManifestId:
      patch && "providerManifestId" in patch
        ? (patch.providerManifestId ?? null)
        : (task.providerManifestId ?? null),
    providerManifestVersion:
      patch && "providerManifestVersion" in patch
        ? patch.providerManifestVersion === 1
          ? 1
          : null
        : task.providerManifestVersion === 1
          ? 1
          : null,
  };
}
