import { useEffect, useMemo } from "react";
import { runGenerateTask } from "@/features/generateQueue/taskExecution";
import { selectLaunchableTaskIds } from "@/features/generateQueue/taskScheduler";
import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";

const LEGACY_INTERIOR_TASK_ERROR =
  "室内设计节点已改为提示词输出，请连接 AI 绘图节点重新生成。";

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
      const task = useTaskQueueStore
        .getState()
        .tasks.find((candidate) => candidate.id === taskId);
      const sourceNode = useCanvasStore
        .getState()
        .nodes.find((node) => node.id === task?.sourceNodeId);
      if (sourceNode?.type === "interiorDesignNode") {
        useTaskQueueStore
          .getState()
          .markTaskError(taskId, LEGACY_INTERIOR_TASK_ERROR);
        continue;
      }

      const claimedTask = useTaskQueueStore.getState().claimTask(taskId);
      if (claimedTask) void runGenerateTask(taskId);
    }
  }, [isProjectReady, launchableTaskIds, runtimeVersion]);

  return null;
}
