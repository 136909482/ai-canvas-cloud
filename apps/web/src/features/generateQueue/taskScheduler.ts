import type { GenerateTask } from "@/types";
import {
  getTaskLaneKey,
  localConcurrencyPolicy,
  type ConcurrencyPolicy,
} from "./concurrencyPolicy";

export function selectLaunchableTaskIds(
  tasks: GenerateTask[],
  policy: ConcurrencyPolicy = localConcurrencyPolicy,
) {
  const laneUsage = new Map<GenerateTask["kind"], number>();

  for (const task of tasks) {
    if (task.status !== "running") continue;
    const lane = getTaskLaneKey(task);
    laneUsage.set(lane, (laneUsage.get(lane) ?? 0) + 1);
  }

  return [...tasks]
    .filter((task) => task.status === "queued")
    .sort((left, right) => left.createdAt - right.createdAt)
    .filter((task) => {
      const lane = getTaskLaneKey(task);
      const usage = laneUsage.get(lane) ?? 0;
      if (usage >= policy.getLimit(task.kind)) return false;
      laneUsage.set(lane, usage + 1);
      return true;
    })
    .map((task) => task.id);
}
