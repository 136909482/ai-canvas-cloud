import type { GenerateTask } from "@/types";

export const LOCAL_IMAGE_CONCURRENCY_LIMIT = 8;
export const LOCAL_VIDEO_CONCURRENCY_LIMIT = 1;

export interface ConcurrencyPolicy {
  getLimit(kind: GenerateTask["kind"]): number;
}

export const localConcurrencyPolicy: ConcurrencyPolicy = {
  getLimit(kind) {
    return kind === "video"
      ? LOCAL_VIDEO_CONCURRENCY_LIMIT
      : LOCAL_IMAGE_CONCURRENCY_LIMIT;
  },
};

export function getTaskLaneKey(task: Pick<GenerateTask, "kind">) {
  return task.kind;
}
