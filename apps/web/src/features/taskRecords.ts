import {
  API_V1_PREFIX,
  type CreateGenerationTaskRecordRequest,
  type GenerationFailureCategory,
} from "@ai-canvas-cloud/contracts";
import type { GenerateTask } from "@/types";
import { persistLocalTaskDetail } from "./taskRecords/localTaskDetails";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getTaskRecordModelEntryId(task: Pick<GenerateTask, "model">) {
  const modelEntryId = task.model.trim();
  return UUID_PATTERN.test(modelEntryId) ? modelEntryId : null;
}

export function reportGenerationTaskRecord(
  input: CreateGenerationTaskRecordRequest,
) {
  if (typeof fetch !== "function") {
    return Promise.resolve(false);
  }

  return fetch(`${API_V1_PREFIX}/task-records`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  })
    .then((response) => response.ok)
    .catch(() => false);
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
  const cloudReport = reportGenerationTaskRecord({
    clientTaskId: task.id,
    title: taskTitle(task),
    category: task.kind,
    status: terminal.status,
    failureCategory:
      terminal.status === "failed" ? terminal.failureCategory : null,
    resultCount: terminal.status === "succeeded" ? terminal.resultCount : 0,
    durationMs: taskDurationMs(task),
    // Cloud records reference the model entry, not the private Provider profile.
    // Older/local tasks may contain an upstream model name, so omit it rather
    // than sending a value that violates the UUID-only API contract.
    modelEntryId: getTaskRecordModelEntryId(task),
    assetIds: resultAsset?.assetId ? [resultAsset.assetId] : [],
    startedAt: new Date(task.startedAt).toISOString(),
    completedAt: new Date(task.finishedAt ?? Date.now()).toISOString(),
  });
  // 敏感详情（Prompt、模型参数、错误正文）只持久化到本地加密存储。
  void persistLocalTaskDetail(task, terminal).catch(() => undefined);
  return cloudReport;
}

export async function backfillTerminalTaskRecords(tasks: GenerateTask[]) {
  const terminalTasks = tasks
    .filter(
      (task) =>
        UUID_PATTERN.test(task.id) &&
        task.finishedAt !== null &&
        (task.status === "done" || task.status === "error"),
    )
    .sort((left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0))
    .slice(0, 50);

  await Promise.all(
    terminalTasks.map((task) =>
      reportTaskRecordForTask(
        task,
        task.status === "done"
          ? { status: "succeeded", resultCount: 1 }
          : { status: "failed", failureCategory: "unknown" },
      ),
    ),
  );
}
