import { useCanvasStore } from "@/store/useCanvasStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import type { GenerateTask, WorkspaceImageAsset } from "@/types";
import { selectLatestSuccessfulImageTask } from "./taskResultPolicy";

type SourceTaskStatus = "queued" | "generating" | "done" | "error";

export function resolvePreviewSourceImageNodeId(
  sourceImageNodeId: string | null,
) {
  if (!sourceImageNodeId) return null;

  const sourceNode = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === sourceImageNodeId);

  if (!sourceNode) return null;
  if (sourceNode.type === "imageNode") return sourceNode.id;

  if (sourceNode.type === "generatedPreviewNode") {
    return typeof sourceNode.data?.sourceImageNodeId === "string"
      ? sourceNode.data.sourceImageNodeId
      : null;
  }

  return null;
}

export function resolveTaskSourceImageUrl(sourceImageNodeId: string | null) {
  if (!sourceImageNodeId) return null;

  const sourceNode = useCanvasStore
    .getState()
    .nodes.find((node) => node.id === sourceImageNodeId);
  return typeof sourceNode?.data?.imageUrl === "string" &&
    sourceNode.data.imageUrl
    ? sourceNode.data.imageUrl
    : null;
}

export function getActiveSourceTaskState(sourceNodeId: string) {
  const tasks = useTaskQueueStore.getState().tasks;
  const runningTask = tasks
    .filter(
      (task) => task.sourceNodeId === sourceNodeId && task.status === "running",
    )
    .sort((left, right) => left.startedAt - right.startedAt)[0];

  if (runningTask) {
    return {
      status: "generating" as const,
      activeTaskId: runningTask.id,
      errorMsg: "",
    };
  }

  const queuedTask = tasks
    .filter(
      (task) => task.sourceNodeId === sourceNodeId && task.status === "queued",
    )
    .sort((left, right) => left.createdAt - right.createdAt)[0];

  if (!queuedTask) return null;

  return {
    status: "queued" as const,
    activeTaskId: queuedTask.id,
    errorMsg: "",
  };
}

export function syncSourceNodeAfterTaskSettles(
  task: GenerateTask,
  settledState: {
    status: "done" | "error";
    errorMsg?: string;
    imageUrl?: string;
    imageAsset?: WorkspaceImageAsset | null;
  },
) {
  const activeState = getActiveSourceTaskState(task.sourceNodeId);
  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) => node.id === task.sourceNodeId,
  );

  if (activeState) {
    canvasStore.updateNodeData(task.sourceNodeId, activeState);
    return;
  }

  const sourceTasks = useTaskQueueStore
    .getState()
    .tasks.filter((candidate) => candidate.sourceNodeId === task.sourceNodeId)
    .sort((left, right) => right.createdAt - left.createdAt);
  const latestTask = sourceTasks[0] ?? task;
  const latestSuccessfulImageTask = selectLatestSuccessfulImageTask(
    sourceTasks,
    task.sourceNodeId,
  );
  const latestSuccessfulPreview = latestSuccessfulImageTask?.previewNodeId
    ? canvasStore.nodes.find(
        (node) => node.id === latestSuccessfulImageTask.previewNodeId,
      )
    : null;
  const latestImageUrl =
    typeof latestSuccessfulPreview?.data?.imageUrl === "string"
      ? latestSuccessfulPreview.data.imageUrl
      : (settledState.imageUrl ?? null);
  const latestImageAsset =
    latestSuccessfulPreview?.data?.imageAsset ?? settledState.imageAsset;
  const settledStatus =
    sourceTasks.length > 0
      ? latestTask.status === "error"
        ? "error"
        : "done"
      : settledState.status;

  canvasStore.updateNodeData(task.sourceNodeId, {
    status: settledStatus,
    errorMsg:
      settledStatus === "error"
        ? latestTask.errorMsg || settledState.errorMsg || ""
        : "",
    activeTaskId: null,
    ...(sourceNode?.type === "generateNode" && latestImageUrl
      ? { imageUrl: latestImageUrl }
      : {}),
    ...(sourceNode?.type === "generateNode" && latestImageAsset !== undefined
      ? { imageAsset: latestImageAsset }
      : {}),
    ...(sourceNode?.type === "entourageNode" && latestImageUrl
      ? { imageUrl: latestImageUrl, lastRunAt: Date.now() }
      : {}),
    ...(sourceNode?.type === "entourageNode" && latestImageAsset !== undefined
      ? { imageAsset: latestImageAsset }
      : {}),
  });
}

export function syncSourceNodeWithTask(
  task: GenerateTask,
  status: SourceTaskStatus,
  errorMsg = "",
) {
  const canvasStore = useCanvasStore.getState();
  const sourceNode = canvasStore.nodes.find(
    (node) => node.id === task.sourceNodeId,
  );

  if (
    !sourceNode ||
    (sourceNode.type !== "generateNode" &&
      sourceNode.type !== "imageEditNode" &&
      sourceNode.type !== "entourageNode" &&
      sourceNode.type !== "videoGenerateNode")
  ) {
    return;
  }

  const patch: Record<string, unknown> = {
    prompt: task.prompt,
    model: task.model,
    ratio: task.ratio,
    resolution: task.resolution,
    status,
    errorMsg,
  };

  if (
    sourceNode.type === "generateNode" ||
    sourceNode.type === "imageEditNode" ||
    sourceNode.type === "entourageNode"
  ) {
    patch.negativePrompt = task.negativePrompt;
    patch.activeTaskId =
      status === "queued" || status === "generating" ? task.id : null;
  }

  if (sourceNode.type === "entourageNode") {
    patch.sourceImageNodeId = task.sourceImageNodeId;
  }

  if (sourceNode.type === "videoGenerateNode") {
    patch.mode = task.videoMode ?? sourceNode.data?.mode ?? "text";
    patch.duration = task.videoDuration ?? sourceNode.data?.duration ?? "5s";
  }

  if (sourceNode.type === "imageEditNode") {
    patch.sourceImageNodeId = task.sourceImageNodeId;
    patch.maskDataUrl =
      task.maskImageUrl ?? sourceNode.data?.maskDataUrl ?? null;
  }

  canvasStore.updateNodeData(task.sourceNodeId, patch);
}

export function syncPreviewNodeWithTask(
  task: GenerateTask,
  status: SourceTaskStatus,
  errorMsg = "",
) {
  if (!task.previewNodeId) return;

  useCanvasStore.getState().updateNodeData(task.previewNodeId, {
    prompt: task.prompt,
    model: task.model,
    ratio: task.ratio,
    status,
    errorMsg,
    taskId: task.id,
  });
}

export function syncVideoNodeWithTask(
  task: GenerateTask,
  status: SourceTaskStatus,
  errorMsg = "",
) {
  if (!task.previewNodeId) return;

  useCanvasStore.getState().updateNodeData(task.previewNodeId, {
    status,
    errorMsg,
    taskId: task.id,
    name:
      status === "done"
        ? "\u89c6\u9891\u751f\u6210\u7ed3\u679c"
        : "\u89c6\u9891\u751f\u6210\u4e2d",
  });
}
