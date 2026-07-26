import type { GenerateTask } from "@/types";

export type TaskQueueFilter = "all" | "active" | "finished";

export function filterTaskQueueTasks(
  tasks: GenerateTask[],
  filter: TaskQueueFilter,
) {
  if (filter === "all") {
    return tasks;
  }

  const active = filter === "active";
  return tasks.filter(
    (task) =>
      (task.status === "queued" || task.status === "running") === active,
  );
}

export function getTaskQueuePosition(tasks: GenerateTask[], taskId: string) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.status !== "queued") return null;

  const position = tasks
    .filter(
      (candidate) =>
        candidate.kind === task.kind && candidate.status === "queued",
    )
    .sort((left, right) => left.createdAt - right.createdAt)
    .findIndex((candidate) => candidate.id === taskId);

  return position >= 0 ? position + 1 : null;
}

export function getTaskProgressLabel(task: GenerateTask) {
  if (task.status === "queued") return "排队中";
  if (task.status === "done") return "已完成";
  if (task.status === "error") return "失败";
  if (task.phase === "polling") return "服务商生成中";
  if (task.phase === "persisting") return "保存中";
  return "请求中";
}

export function hasInterruptibleSynchronousImageTask(tasks: GenerateTask[]) {
  return tasks.some(
    (task) =>
      task.kind === "image" &&
      task.status === "running" &&
      task.phase !== "persisting" &&
      task.executionMode !== "polling" &&
      !task.remoteTaskId,
  );
}

export function canCancelQueuedTask(task: GenerateTask) {
  return (
    task.status === "queued" &&
    task.phase !== "polling" &&
    task.phase !== "persisting" &&
    !task.remoteTaskId
  );
}
