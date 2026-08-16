import {
  API_V1_PREFIX,
  type CreateGenerationTaskRecordRequest,
  type GenerationFailureCategory,
} from "@ai-canvas-cloud/contracts";
import type { GenerateTask } from "@/types";
import { persistLocalTaskDetail } from "./taskRecords/localTaskDetails";

export function reportGenerationTaskRecord(
  input: CreateGenerationTaskRecordRequest,
) {
  if (typeof fetch !== "function") {
    return;
  }

  void fetch(`${API_V1_PREFIX}/task-records`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => undefined);
}

function taskTitle(task: GenerateTask) {
  return `${task.kind === "video" ? "视频生成" : "图像生成"} #${task.displayId}`;
}

function taskDurationMs(task: GenerateTask) {
  if (!task.startedAt || !task.finishedAt) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(
      24 * 60 * 60 * 1_000,
      Math.round(task.finishedAt - task.startedAt),
    ),
  );
}

// 上报脱敏任务摘要到云端：不含 Prompt、endpoint、真实模型 ID、
// remote task ID 或上游错误正文；敏感详情保留在浏览器本地。
export function reportTaskRecordForTask(
  task: GenerateTask,
  terminal:
    | { status: "succeeded"; resultCount: number }
    | { status: "failed"; failureCategory: GenerationFailureCategory }
    | { status: "canceled" },
) {
  const resultAsset =
    task.kind === "video" ? task.resultVideoAsset : task.resultImageAsset;
  reportGenerationTaskRecord({
    clientTaskId: task.id,
    title: taskTitle(task),
    category: task.kind,
    status: terminal.status,
    failureCategory:
      terminal.status === "failed" ? terminal.failureCategory : null,
    resultCount: terminal.status === "succeeded" ? terminal.resultCount : 0,
    durationMs: taskDurationMs(task),
    modelEntryId: task.apiProfileId ?? null,
    assetIds: resultAsset?.assetId ? [resultAsset.assetId] : [],
    startedAt: new Date(task.startedAt).toISOString(),
    completedAt: new Date(task.finishedAt ?? Date.now()).toISOString(),
  });
  // 敏感详情（Prompt、模型参数、错误正文）只持久化到本地加密存储。
  void persistLocalTaskDetail(task, terminal).catch(() => undefined);
}
