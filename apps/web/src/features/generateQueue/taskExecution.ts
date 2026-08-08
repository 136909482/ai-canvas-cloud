import type { GenerateImageParams } from "@/api/imageAdapter";
import {
  submitAliyunTextToVideoGeneration,
  waitForAliyunVideoGeneration,
  type GenerateVideoParams,
} from "@/api/videoAdapter";
import {
  beginGenerationTelemetry,
  classifyGenerationFailure,
  completeGenerationTelemetry,
  restoreGenerationTelemetryAttempt,
  type GenerationTelemetryAttempt,
} from "@/features/generationTelemetry";
import { resolveRuntimeModelConfig } from "@/features/settings/providerConfig";
import { platformBridge } from "@/platform";
import { useCanvasStore } from "@/store/useCanvasStore";
import { reportDiagnostic } from "@/store/useDiagnosticsStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import type { GenerateTask } from "@/types";
import {
  clearStagedGeneratedImageResult,
  getVideoNodeSize,
  loadStagedGeneratedImageResult,
  loadVideoMetadata,
  persistGeneratedImageBlob,
  persistGeneratedVideoAsset,
  stageGeneratedImageResult,
} from "./generatedAssets";
import {
  createProviderBindingFingerprint,
  getImageProviderAdapter,
  resolveTaskAdapterId,
  resolveTaskExecutionMode,
} from "./imageProviderAdapters";
import { runWithTaskImageInputRefresh } from "./taskImageInputs";
import { getPreviewNodeSize, loadImageDimensions } from "./previewUtils";
import {
  resolvePreviewSourceImageNodeId,
  resolveTaskSourceImageUrl,
  syncPreviewNodeWithTask,
  syncSourceNodeAfterTaskSettles,
  syncSourceNodeWithTask,
  syncVideoNodeWithTask,
} from "./taskCanvasState";

const UI_TEXT = {
  missingSourceNode:
    "\u751f\u6210\u4efb\u52a1\u5bf9\u5e94\u7684 AI \u7ed8\u56fe\u8282\u70b9\u4e0d\u5b58\u5728",
  missingVideoSourceNode:
    "\u751f\u6210\u4efb\u52a1\u5bf9\u5e94\u7684 AI \u89c6\u9891\u8282\u70b9\u4e0d\u5b58\u5728",
  missingPreviewNode:
    "\u751f\u6210\u4efb\u52a1\u5bf9\u5e94\u7684\u9884\u89c8\u8282\u70b9\u4e0d\u5b58\u5728",
  missingVideoNode:
    "\u751f\u6210\u4efb\u52a1\u5bf9\u5e94\u7684\u89c6\u9891\u7ed3\u679c\u8282\u70b9\u4e0d\u5b58\u5728",
  restoreFailurePrefix: "\u9879\u76ee\u6062\u590d\u5931\u8d25\uff1a",
  assetPersistFailed:
    "\u751f\u6210\u56fe\u7247\u5df2\u8fd4\u56de\uff0c\u4f46\u5199\u5165\u672c\u5730\u8d44\u4ea7\u5931\u8d25",
} as const;

const activeRemoteResumeTaskIds = new Set<string>();

class GenerationAssetPersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationAssetPersistError";
  }
}

function generationFailureCategory(error: unknown) {
  return error instanceof GenerationAssetPersistError
    ? ("asset_upload" as const)
    : classifyGenerationFailure(error);
}

function getTaskRuntime(taskId: string) {
  const task = useTaskQueueStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) => node.id === task.sourceNodeId,
  );
  if (
    !sourceNode ||
    (task.kind === "video"
      ? sourceNode.type !== "videoGenerateNode"
      : sourceNode.type !== "generateNode" &&
        sourceNode.type !== "imageEditNode")
  ) {
    throw new Error(
      task.kind === "video"
        ? UI_TEXT.missingVideoSourceNode
        : UI_TEXT.missingSourceNode,
    );
  }

  if (!task.previewNodeId) {
    throw new Error(
      task.kind === "video"
        ? UI_TEXT.missingVideoNode
        : UI_TEXT.missingPreviewNode,
    );
  }

  const resultNode = canvasStore.nodes.find(
    (node) =>
      node.id === task.previewNodeId &&
      (task.kind === "video"
        ? node.type === "videoNode"
        : node.type === "generatedPreviewNode"),
  );
  if (!resultNode) {
    throw new Error(
      task.kind === "video"
        ? UI_TEXT.missingVideoNode
        : UI_TEXT.missingPreviewNode,
    );
  }

  return { task, sourceNode, resultNode };
}

function getTaskModelConfig(task: GenerateTask) {
  const settings = useSettingsStore.getState();
  const resolution = resolveRuntimeModelConfig(settings.config, {
    modelEntryId: task.model,
    category: task.kind,
    requireCredentials: true,
  });

  if (!resolution.ok) {
    throw new Error(resolution.diagnostic.message);
  }

  const currentAdapterId = resolveTaskAdapterId(
    resolution.runtimeConfig,
    task.kind,
  );
  const currentFingerprint = createProviderBindingFingerprint(
    resolution.runtimeConfig,
    resolution.profile.updatedAt,
    task.kind,
  );

  if (
    (task.adapterId && task.adapterId !== currentAdapterId) ||
    (task.providerBindingFingerprint &&
      task.providerBindingFingerprint !== currentFingerprint)
  ) {
    throw new Error(
      "服务商配置已发生变化，旧任务不会使用新的接口或密钥继续执行，请手动重新生成。",
    );
  }

  return {
    modelConfig: resolution.runtimeConfig,
    adapterId: currentAdapterId,
    providerBindingFingerprint: currentFingerprint,
    providerSnapshot: {
      apiProfileId: resolution.profile.id,
      apiProfileName: resolution.profile.name,
      provider: resolution.runtimeConfig.provider,
      executionMode: resolveTaskExecutionMode(
        resolution.runtimeConfig,
        task.kind,
      ),
      adapterId: currentAdapterId,
      providerBindingFingerprint: currentFingerprint,
      providerManifestId: resolution.runtimeConfig.customManifest?.id ?? null,
      providerManifestVersion:
        resolution.runtimeConfig.customManifest?.schemaVersion ?? null,
    },
  };
}

function buildTaskRequestParams(task: GenerateTask) {
  const {
    modelConfig,
    adapterId,
    providerBindingFingerprint,
    providerSnapshot,
  } = getTaskModelConfig(task);
  const provider = modelConfig.provider ?? "aliyun";
  const apiUrl = modelConfig.apiUrl;

  if (task.kind === "video") {
    return {
      modelConfig,
      adapterId,
      providerBindingFingerprint,
      providerSnapshot,
      provider,
      requestParams: {
        prompt: task.prompt,
        ratio: task.ratio,
        resolution: task.resolution,
        duration: task.videoDuration ?? "5s",
        apiKey: modelConfig.apiKey,
        apiUrl,
        model: modelConfig.modelId,
      } as GenerateVideoParams,
    };
  }

  return {
    modelConfig,
    adapterId,
    providerBindingFingerprint,
    providerSnapshot,
    provider,
    requestParams: {
      prompt: task.prompt,
      negativePrompt: task.negativePrompt,
      ratio: task.ratio,
      resolution: task.resolution,
      inputFidelity: task.inputFidelity ?? null,
      quality: task.quality ?? null,
      googleSearch: Boolean(task.googleSearch),
      googleImageSearch: Boolean(task.googleImageSearch),
      editImageUrl:
        task.operationType === "image-edit"
          ? resolveTaskSourceImageUrl(task.sourceImageNodeId)
          : null,
      maskImageUrl:
        task.operationType === "image-edit"
          ? (task.maskImageUrl ?? null)
          : null,
      referenceImageUrl: task.referenceImages[0]?.imageUrl ?? null,
      referenceImageUrls: task.referenceImages.map((source) => source.imageUrl),
      apiKey: modelConfig.apiKey,
      apiUrl,
      model: modelConfig.modelId,
      provider,
      authMode: modelConfig.authMode,
      customManifest: modelConfig.customManifest,
      requestMode: modelConfig.requestMode,
      operationType: task.operationType,
    } as const,
  };
}

async function finalizeSuccessfulTask(
  task: GenerateTask,
  imageUrl: string,
  runtimeVersion: number,
) {
  // The provider has already completed at this point. Mark persistence before
  // downloading the remote image so a slow CDN does not look like polling.
  useTaskQueueStore.getState().setTaskPhase(task.id, "persisting");
  const blob = await stageGeneratedImageResult(task, imageUrl).catch(
    (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new GenerationAssetPersistError(
        `${UI_TEXT.assetPersistFailed}：${reason}`,
      );
    },
  );
  await finalizeStagedSuccessfulTask(task, runtimeVersion, blob);
}

async function finalizeStagedSuccessfulTask(
  task: GenerateTask,
  runtimeVersion: number,
  stagedBlob?: Blob,
) {
  const blob = stagedBlob ?? (await loadStagedGeneratedImageResult(task));
  if (!blob) {
    throw new GenerationAssetPersistError(
      "待上传的生成结果不存在，不能在未确认服务商状态时自动重新生成。",
    );
  }

  useTaskQueueStore.getState().setTaskPhase(task.id, "persisting");
  const { asset, resolvedUrl } = await persistGeneratedImageBlob(
    task,
    blob,
  ).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new GenerationAssetPersistError(
      `${UI_TEXT.assetPersistFailed}：${reason}`,
    );
  });

  let imageWidth = 0;
  let imageHeight = 0;

  try {
    const dimensions = await loadImageDimensions(resolvedUrl);
    imageWidth = dimensions.width;
    imageHeight = dimensions.height;
  } catch {
    imageWidth = 0;
    imageHeight = 0;
  }

  const previewSize =
    imageWidth > 0 && imageHeight > 0
      ? getPreviewNodeSize(imageWidth, imageHeight)
      : { width: 300, height: 260 };

  if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
    return;
  }

  const { updateNodeData } = useCanvasStore.getState();
  if (task.previewNodeId) {
    updateNodeData(task.previewNodeId, {
      imageUrl: resolvedUrl,
      imageAsset: asset,
      apiProfileName: task.apiProfileName ?? null,
      status: "done",
      errorMsg: "",
      imageWidth,
      imageHeight,
      width: previewSize.width,
      height: previewSize.height,
      sourceImageNodeId: resolvePreviewSourceImageNodeId(
        task.sourceImageNodeId,
      ),
      originOperation:
        task.operationType === "image-edit" ? "image-edit" : "generate",
      taskId: task.id,
    });
  }

  useTaskQueueStore.getState().markTaskDone(task.id, {
    resultImageAsset: asset,
  });
  await clearStagedGeneratedImageResult(task);
  syncSourceNodeAfterTaskSettles(task, {
    status: "done",
    imageUrl: resolvedUrl,
    imageAsset: asset,
  });
}

async function finalizeSuccessfulVideoTask(
  task: GenerateTask,
  videoUrl: string,
  runtimeVersion: number,
) {
  const { asset, resolvedUrl } = await persistGeneratedVideoAsset(
    task,
    videoUrl,
  ).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new GenerationAssetPersistError(
      `生成视频已返回，但写入本地资产失败：${reason}`,
    );
  });

  let metadata = { duration: 0, width: 0, height: 0 };

  try {
    metadata = await loadVideoMetadata(resolvedUrl);
  } catch {
    metadata = { duration: 0, width: 0, height: 0 };
  }

  const videoSize = getVideoNodeSize(metadata.width, metadata.height);

  if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
    return;
  }

  const { updateNodeData } = useCanvasStore.getState();

  if (task.previewNodeId) {
    updateNodeData(task.previewNodeId, {
      videoUrl: resolvedUrl,
      videoAsset: asset,
      name: "视频生成结果",
      duration: metadata.duration,
      videoWidth: metadata.width,
      videoHeight: metadata.height,
      status: "done",
      errorMsg: "",
      width: videoSize.width,
      height: videoSize.height,
    });
  }

  useTaskQueueStore.getState().markTaskDone(task.id, {
    resultVideoAsset: asset,
  });
  syncSourceNodeAfterTaskSettles(task, {
    status: "done",
  });
}

function isTaskQueueRuntimeCurrent(runtimeVersion: number) {
  return useTaskQueueStore.getState().runtimeVersion === runtimeVersion;
}

function markTaskRestoreError(task: GenerateTask, errorMessage: string) {
  const latestTask =
    useTaskQueueStore.getState().tasks.find((item) => item.id === task.id) ??
    task;
  const fullMessage = `${UI_TEXT.restoreFailurePrefix}${errorMessage}`;
  reportDiagnostic({
    area: "resource",
    title: "生成任务恢复失败",
    error: errorMessage,
    code: "TASK_RESTORE_FAILED",
    privateProviderError: true,
    context: { taskId: task.id },
  });

  if (latestTask.previewNodeId) {
    const resultNode = useCanvasStore
      .getState()
      .nodes.find(
        (node) =>
          node.id === latestTask.previewNodeId &&
          (latestTask.kind === "video"
            ? node.type === "videoNode"
            : node.type === "generatedPreviewNode"),
      );

    if (resultNode) {
      useCanvasStore.getState().updateNodeData(latestTask.previewNodeId, {
        status: "error",
        errorMsg: fullMessage,
        ...(latestTask.kind === "image" ? { taskId: latestTask.id } : {}),
      });
    }
  }

  useTaskQueueStore.getState().markTaskError(latestTask.id, fullMessage);

  const sourceNode = useCanvasStore
    .getState()
    .nodes.find(
      (node) =>
        node.id === latestTask.sourceNodeId &&
        (latestTask.kind === "video"
          ? node.type === "videoGenerateNode"
          : node.type === "generateNode" || node.type === "imageEditNode"),
    );

  if (sourceNode) {
    syncSourceNodeAfterTaskSettles(latestTask, {
      status: "error",
      errorMsg: fullMessage,
    });
  }
}

async function resumeRemoteGenerateTask(taskId: string) {
  const taskState = useTaskQueueStore.getState();
  const runtimeVersion = taskState.runtimeVersion;
  const runtimeTaskId = `${runtimeVersion}:${taskId}`;

  if (activeRemoteResumeTaskIds.has(runtimeTaskId)) {
    return;
  }

  const task = taskState.tasks.find((item) => item.id === taskId);

  if (!task || task.status !== "running" || !task.remoteTaskId) {
    return;
  }

  activeRemoteResumeTaskIds.add(runtimeTaskId);
  let telemetryAttempt: GenerationTelemetryAttempt | null = null;

  try {
    const { task: runningTask } = getTaskRuntime(taskId);
    telemetryAttempt = restoreGenerationTelemetryAttempt({
      attemptId: runningTask.telemetryAttemptId,
      category: runningTask.kind,
      startedAt: runningTask.telemetryStartedAt,
    });
    const { adapterId, provider, providerSnapshot, requestParams } =
      buildTaskRequestParams(runningTask);
    useTaskQueueStore
      .getState()
      .bindTaskProvider(runningTask.id, providerSnapshot);

    if (!runningTask.remoteTaskId) {
      throw new Error(
        runningTask.kind === "video"
          ? UI_TEXT.missingVideoNode
          : UI_TEXT.missingPreviewNode,
      );
    }

    syncSourceNodeWithTask(runningTask, "generating");
    useTaskQueueStore
      .getState()
      .setRemoteTaskStatus(runningTask.id, "IN_PROGRESS");

    if (runningTask.kind === "video") {
      if (provider !== "aliyun") {
        throw new Error(
          "\u5f53\u524d\u89c6\u9891\u4efb\u52a1\u4ec5\u652f\u6301\u963f\u91cc\u767e\u70bc\u8fdc\u7a0b\u8f6e\u8be2\u6062\u590d",
        );
      }

      syncVideoNodeWithTask(runningTask, "generating");
      const videoUrl = await waitForAliyunVideoGeneration(
        requestParams as GenerateVideoParams,
        runningTask.remoteTaskId,
        (remoteStatus) => {
          if (isTaskQueueRuntimeCurrent(runtimeVersion)) {
            useTaskQueueStore
              .getState()
              .setRemoteTaskStatus(runningTask.id, remoteStatus);
          }
        },
      );

      if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
        return;
      }

      await finalizeSuccessfulVideoTask(runningTask, videoUrl, runtimeVersion);
      completeGenerationTelemetry(telemetryAttempt, {
        status: "succeeded",
        resultCount: 1,
      });
      return;
    }

    syncPreviewNodeWithTask(runningTask, "generating");
    const adapter = getImageProviderAdapter(adapterId);
    if (!adapter.waitForRemote) {
      throw new Error("当前图片适配器不支持远程任务恢复");
    }
    const imageUrl = await adapter.waitForRemote(
      requestParams as GenerateImageParams,
      runningTask.remoteTaskId,
      (remoteStatus) => {
        if (isTaskQueueRuntimeCurrent(runtimeVersion)) {
          useTaskQueueStore
            .getState()
            .setRemoteTaskStatus(runningTask.id, remoteStatus);
        }
      },
    );

    if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
      return;
    }

    await finalizeSuccessfulTask(runningTask, imageUrl, runtimeVersion);
    completeGenerationTelemetry(telemetryAttempt, {
      status: "succeeded",
      resultCount: 1,
    });
  } catch (error) {
    if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    completeGenerationTelemetry(telemetryAttempt, {
      status: "failed",
      failureCategory: generationFailureCategory(error),
    });
    reportDiagnostic({
      area: "resource",
      title: "远程任务恢复失败",
      error,
      code: "REMOTE_TASK_RESUME_FAILED",
      privateProviderError: true,
      context: { taskId },
    });
    const latestTask = useTaskQueueStore
      .getState()
      .tasks.find((item) => item.id === taskId);

    if (latestTask?.previewNodeId) {
      const resultNode = useCanvasStore
        .getState()
        .nodes.find(
          (node) =>
            node.id === latestTask.previewNodeId &&
            (latestTask.kind === "video"
              ? node.type === "videoNode"
              : node.type === "generatedPreviewNode"),
        );

      if (resultNode) {
        useCanvasStore.getState().updateNodeData(latestTask.previewNodeId, {
          status: "error",
          errorMsg: errorMessage,
          ...(latestTask.kind === "image" ? { taskId } : {}),
        });
      }
    }

    if (
      error instanceof GenerationAssetPersistError &&
      latestTask?.kind === "image"
    ) {
      useTaskQueueStore.getState().markTaskPersistError(taskId, errorMessage);
    } else {
      useTaskQueueStore.getState().markTaskError(taskId, errorMessage);
    }
    if (latestTask) {
      syncSourceNodeAfterTaskSettles(latestTask, {
        status: "error",
        errorMsg: errorMessage,
      });
    }
  } finally {
    activeRemoteResumeTaskIds.delete(runtimeTaskId);
  }
}

export async function restoreTaskQueueAfterSnapshotLoad() {
  const taskStore = useTaskQueueStore.getState();
  const tasks = [...taskStore.tasks];
  const canvasNodes = useCanvasStore.getState().nodes;
  const nodeIds = new Set(canvasNodes.map((node) => node.id));

  for (const task of tasks) {
    if (!nodeIds.has(task.sourceNodeId)) {
      taskStore.removeTask(task.id);
      continue;
    }

    if (task.previewNodeId && !nodeIds.has(task.previewNodeId)) {
      taskStore.removeTask(task.id);
      continue;
    }

    if (task.status === "done" || task.status === "error") {
      continue;
    }

    if (task.status === "queued") {
      syncSourceNodeWithTask(task, "queued");
      if (task.kind === "video") {
        syncVideoNodeWithTask(task, "queued");
      } else {
        syncPreviewNodeWithTask(task, "queued");
      }
      continue;
    }

    if (task.remoteTaskId) {
      try {
        const { provider } = buildTaskRequestParams(task);

        if (
          task.kind === "image" ||
          (task.kind === "video" && provider === "aliyun")
        ) {
          syncSourceNodeWithTask(task, "generating");
          if (task.kind === "video") {
            syncVideoNodeWithTask(task, "generating");
          } else {
            syncPreviewNodeWithTask(task, "generating");
          }
          void resumeRemoteGenerateTask(task.id);
          continue;
        }
      } catch (error) {
        markTaskRestoreError(
          task,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
    }

    taskStore.markTaskQueued(task.id, {
      kind: task.kind,
      sourceNodeId: task.sourceNodeId,
      previewNodeId: task.previewNodeId,
      model: task.model,
      prompt: task.prompt,
      negativePrompt: task.negativePrompt,
      ratio: task.ratio,
      resolution: task.resolution,
      operationType: task.operationType,
      sourceImageNodeId: task.sourceImageNodeId,
      maskImageUrl: task.maskImageUrl ?? null,
      referenceImages: task.referenceImages,
      editImageSource: task.editImageSource ?? null,
      maskImageSource: task.maskImageSource ?? null,
      inputFidelity: task.inputFidelity ?? null,
      quality: task.quality ?? null,
      googleSearch: Boolean(task.googleSearch),
      googleImageSearch: Boolean(task.googleImageSearch),
      videoMode: task.videoMode ?? null,
      videoDuration: task.videoDuration ?? null,
    });

    const queuedTask = useTaskQueueStore
      .getState()
      .tasks.find((item) => item.id === task.id);
    if (queuedTask) {
      syncSourceNodeWithTask(queuedTask, "queued");
      if (queuedTask.kind === "video") {
        syncVideoNodeWithTask(queuedTask, "queued");
      } else {
        syncPreviewNodeWithTask(queuedTask, "queued");
      }
    }
  }
}

export async function runGenerateTask(taskId: string) {
  const taskStore = useTaskQueueStore.getState();
  const runtimeVersion = taskStore.runtimeVersion;
  const claimedTask = taskStore.tasks.find((item) => item.id === taskId);

  if (!claimedTask || claimedTask.status !== "running") {
    return;
  }

  let telemetryAttempt: GenerationTelemetryAttempt | null = null;

  try {
    const { task: runningTask } = getTaskRuntime(taskId);

    if (runningTask.phase === "polling" && runningTask.remoteTaskId) {
      await resumeRemoteGenerateTask(taskId);
      return;
    }

    if (runningTask.phase === "persisting") {
      telemetryAttempt = restoreGenerationTelemetryAttempt({
        attemptId: runningTask.telemetryAttemptId,
        category: runningTask.kind,
        startedAt: runningTask.telemetryStartedAt,
      });
      if (runningTask.kind !== "image") {
        throw new GenerationAssetPersistError(
          "当前只有图片任务支持从本地待上传结果恢复。",
        );
      }

      await finalizeStagedSuccessfulTask(runningTask, runtimeVersion);
      completeGenerationTelemetry(telemetryAttempt, {
        status: "succeeded",
        resultCount: 1,
      });
      return;
    }

    syncSourceNodeWithTask(runningTask, "generating");

    if (runningTask.kind === "video") {
      syncVideoNodeWithTask(runningTask, "generating");
      const { provider, providerSnapshot, requestParams } =
        buildTaskRequestParams(runningTask);
      taskStore.bindTaskProvider(runningTask.id, providerSnapshot);

      if (provider !== "aliyun") {
        throw new Error("当前视频生成仅支持阿里百炼 provider");
      }

      const videoRequestParams = requestParams as GenerateVideoParams;
      telemetryAttempt = beginGenerationTelemetry("video");
      taskStore.attachTelemetryAttempt(
        runningTask.id,
        telemetryAttempt.attemptId,
        telemetryAttempt.startedAt,
      );
      const submission =
        await submitAliyunTextToVideoGeneration(videoRequestParams);
      if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
        return;
      }

      taskStore.attachRemoteTask(runningTask.id, submission.taskId);
      const videoUrl = await waitForAliyunVideoGeneration(
        videoRequestParams,
        submission.taskId,
        (remoteStatus) => {
          if (isTaskQueueRuntimeCurrent(runtimeVersion)) {
            useTaskQueueStore
              .getState()
              .setRemoteTaskStatus(runningTask.id, remoteStatus);
          }
        },
      );

      if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
        return;
      }

      await finalizeSuccessfulVideoTask(runningTask, videoUrl, runtimeVersion);
      completeGenerationTelemetry(telemetryAttempt, {
        status: "succeeded",
        resultCount: 1,
      });
      return;
    }

    syncPreviewNodeWithTask(runningTask, "generating");
    const { adapterId, providerSnapshot, requestParams } =
      buildTaskRequestParams(runningTask);
    taskStore.bindTaskProvider(runningTask.id, providerSnapshot);
    if (adapterId === "dashscope-video-polling") {
      throw new Error("图片任务不能使用视频 Provider 适配器");
    }
    const adapter = getImageProviderAdapter(adapterId);
    telemetryAttempt = beginGenerationTelemetry("image");
    taskStore.attachTelemetryAttempt(
      runningTask.id,
      telemetryAttempt.attemptId,
      telemetryAttempt.startedAt,
    );
    let activeImageRequestParams = requestParams as GenerateImageParams;
    const startResult = await runWithTaskImageInputRefresh(
      runningTask,
      {
        resolveAssetUrl: (relativePath) =>
          platformBridge.resolveWorkspaceAssetUrl(relativePath),
        clearAssetUrlCache: () => platformBridge.clearWorkspaceAssetUrlCache(),
      },
      (resolvedInputs) => {
        activeImageRequestParams = {
          ...activeImageRequestParams,
          referenceImageUrl: resolvedInputs.referenceImageUrls[0] ?? null,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          editImageUrl:
            resolvedInputs.editImageUrl ??
            activeImageRequestParams.editImageUrl ??
            null,
          maskImageUrl:
            resolvedInputs.maskImageUrl ??
            activeImageRequestParams.maskImageUrl ??
            null,
        };
        return adapter.start(activeImageRequestParams);
      },
    );
    if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
      return;
    }

    const imageUrl =
      startResult.type === "completed"
        ? startResult.output
        : await (async () => {
            taskStore.attachRemoteTask(
              runningTask.id,
              startResult.remoteTaskId,
            );
            if (!adapter.waitForRemote) {
              throw new Error("当前图片适配器缺少远程任务轮询能力");
            }
            return adapter.waitForRemote(
              activeImageRequestParams,
              startResult.remoteTaskId,
              (remoteStatus) => {
                if (isTaskQueueRuntimeCurrent(runtimeVersion)) {
                  useTaskQueueStore
                    .getState()
                    .setRemoteTaskStatus(runningTask.id, remoteStatus);
                }
              },
            );
          })();

    if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
      return;
    }

    await finalizeSuccessfulTask(runningTask, imageUrl, runtimeVersion);
    completeGenerationTelemetry(telemetryAttempt, {
      status: "succeeded",
      resultCount: 1,
    });
  } catch (error) {
    if (!isTaskQueueRuntimeCurrent(runtimeVersion)) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    completeGenerationTelemetry(telemetryAttempt, {
      status: "failed",
      failureCategory: generationFailureCategory(error),
    });
    const latestTask = useTaskQueueStore
      .getState()
      .tasks.find((item) => item.id === taskId);
    reportDiagnostic({
      area: "model",
      title: latestTask?.kind === "video" ? "视频生成失败" : "图片生成失败",
      error,
      code:
        latestTask?.kind === "video"
          ? "VIDEO_GENERATION_FAILED"
          : "IMAGE_GENERATION_FAILED",
      privateProviderError: true,
      context: { taskId },
    });

    if (latestTask?.previewNodeId) {
      useCanvasStore.getState().updateNodeData(latestTask.previewNodeId, {
        status: "error",
        errorMsg: errorMessage,
        ...(latestTask.kind === "image" ? { taskId } : {}),
      });
    }

    if (
      error instanceof GenerationAssetPersistError &&
      latestTask?.kind === "image"
    ) {
      useTaskQueueStore.getState().markTaskPersistError(taskId, errorMessage);
    } else {
      useTaskQueueStore.getState().markTaskError(taskId, errorMessage);
    }
    if (latestTask) {
      syncSourceNodeAfterTaskSettles(latestTask, {
        status: "error",
        errorMsg: errorMessage,
      });
    }
  }
}
