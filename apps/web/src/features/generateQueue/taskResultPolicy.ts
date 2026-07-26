import type { GenerateTask } from "@/types";

export function canReuseTaskResultNode(
  input: { hasResult: boolean; taskId: unknown },
  reusableTaskId?: string,
) {
  if (input.hasResult) return false;
  if (typeof input.taskId !== "string" || !input.taskId) return true;
  return input.taskId === reusableTaskId;
}

export function selectLatestSuccessfulImageTask(
  tasks: GenerateTask[],
  sourceNodeId: string,
) {
  return tasks
    .filter(
      (task) =>
        task.sourceNodeId === sourceNodeId &&
        task.kind === "image" &&
        task.status === "done",
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}
