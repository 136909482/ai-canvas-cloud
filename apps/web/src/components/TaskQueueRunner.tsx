import { useEffect, useMemo } from "react";
import { runGenerateTask } from "@/features/generateQueue/taskExecution";
import { selectLaunchableTaskIds } from "@/features/generateQueue/taskScheduler";
import { useProjectStore } from "@/store/useProjectStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";

export function TaskQueueRunner() {
  const tasks = useTaskQueueStore((state) => state.tasks);
  const runtimeVersion = useTaskQueueStore((state) => state.runtimeVersion);
  const isProjectReady = useProjectStore((state) => state.isReady);
  const launchableTaskIds = useMemo(
    () => selectLaunchableTaskIds(tasks),
    [tasks],
  );

  useEffect(() => {
    if (!isProjectReady || launchableTaskIds.length === 0) return;

    for (const taskId of launchableTaskIds) {
      const claimedTask = useTaskQueueStore.getState().claimTask(taskId);
      if (claimedTask) void runGenerateTask(taskId);
    }
  }, [isProjectReady, launchableTaskIds, runtimeVersion]);

  return null;
}
