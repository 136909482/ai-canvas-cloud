import { useEffect, useMemo, useState, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { ListTodo, Trash2, X } from "lucide-react";
import { TaskQueueIconButton } from "@/components/TaskQueueIconButton";
import { TASK_QUEUE_COPY } from "@/components/taskQueueCopy";
import { TaskQueueTaskRow } from "@/components/TaskQueueTaskRow";
import { LOCAL_IMAGE_CONCURRENCY_LIMIT } from "@/features/generateQueue/concurrencyPolicy";
import { clearFinishedGenerateTasks } from "@/features/generateQueue/orchestrator";
import {
  filterTaskQueueTasks,
  getTaskQueuePosition,
  type TaskQueueFilter,
} from "@/features/generateQueue/taskQueueView";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { themeClasses } from "@/styles/themeClasses";
import type { GenerateTask } from "@/types";

type TaskQueuePanelProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
};

const FILTERS: ReadonlyArray<readonly [TaskQueueFilter, string]> = [
  ["all", TASK_QUEUE_COPY.allTasks],
  ["active", TASK_QUEUE_COPY.activeTasks],
  ["finished", TASK_QUEUE_COPY.finishedTasks],
];

export function TaskQueuePanel({ panelRef, onClose }: TaskQueuePanelProps) {
  const [filter, setFilter] = useState<TaskQueueFilter>("all");
  const [now, setNow] = useState(() => Date.now());
  const reactFlow = useReactFlow();
  const selectNode = useCanvasStore((state) => state.selectNode);
  const modelEntries = useSettingsStore((state) => state.config.modelEntries);
  const tasks = useTaskQueueStore((state) => state.tasks);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const runningImageTaskCount = tasks.filter(
    (task) => task.kind === "image" && task.status === "running",
  ).length;
  const hasActiveTask = tasks.some(
    (task) => task.status === "queued" || task.status === "running",
  );
  const hasFinishedTask = tasks.some(
    (task) => task.status === "done" || task.status === "error",
  );
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((left, right) => {
        const leftActive =
          left.status === "queued" || left.status === "running";
        const rightActive =
          right.status === "queued" || right.status === "running";

        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1;
        }

        return right.createdAt - left.createdAt;
      }),
    [tasks],
  );
  const filteredTasks = useMemo(
    () => filterTaskQueueTasks(sortedTasks, filter),
    [filter, sortedTasks],
  );
  const modelNameById = useMemo(
    () =>
      new Map(
        modelEntries.map((model) => [
          model.id,
          model.displayName || model.modelId,
        ]),
      ),
    [modelEntries],
  );

  useEffect(() => {
    if (!hasActiveTask) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveTask]);

  const handleLocateResult = (task: GenerateTask) => {
    if (!task.previewNodeId) return;

    const previewNode = reactFlow.getNode(task.previewNodeId);
    selectNode(task.previewNodeId);

    if (previewNode) {
      const width =
        typeof previewNode.width === "number" ? previewNode.width : 300;
      const height =
        typeof previewNode.height === "number" ? previewNode.height : 260;

      void reactFlow.setCenter(
        previewNode.position.x + width / 2,
        previewNode.position.y + height / 2,
        { duration: 360, zoom: 0.9 },
      );
    }

    onClose();
  };

  return (
    <div
      id="task-queue-panel"
      ref={panelRef}
      role="dialog"
      aria-label={TASK_QUEUE_COPY.panelTitle}
      tabIndex={-1}
      data-testid="task-queue-panel"
      className={`fixed left-4 right-4 top-14 z-30 w-auto overflow-hidden rounded-xl [--font-mono:'JetBrains_Mono','Cascadia_Mono','Consolas',monospace] sm:left-auto sm:w-[26rem] ${themeClasses.strongPanel}`}
    >
      <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                className={`text-sm font-semibold ${themeClasses.textPrimary}`}
              >
                {TASK_QUEUE_COPY.panelTitle}
              </div>
              <span className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--control-bg)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[var(--text-muted)]">
                {filteredTasks.length} {TASK_QUEUE_COPY.itemUnit}
              </span>
              {tasks.length > 0 ? (
                <span className="inline-flex items-center rounded border border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--accent-violet-strong)]">
                  {TASK_QUEUE_COPY.imageConcurrency} {runningImageTaskCount}/
                  {LOCAL_IMAGE_CONCURRENCY_LIMIT}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {hasFinishedTask ? (
              <TaskQueueIconButton
                label={TASK_QUEUE_COPY.clearFinished}
                onClick={() => void clearFinishedGenerateTasks()}
                testId="clear-finished-tasks"
                tooltipPlacement="bottom"
                icon={<Trash2 className="h-3.5 w-3.5" />}
              />
            ) : null}
            <TaskQueueIconButton
              label={TASK_QUEUE_COPY.closePanel}
              onClick={onClose}
              showTooltip={false}
              tooltipPlacement="bottom"
              icon={<X className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </div>

      {tasks.length > 0 ? (
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div
            className="grid h-7 grid-cols-3 gap-1 rounded-md bg-[var(--control-bg)] p-0.5"
            role="tablist"
            aria-label={TASK_QUEUE_COPY.panelTitle}
          >
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-[5px] text-[10px] font-medium transition ${filter === value ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filteredTasks.length > 0 ? (
        <div className="task-queue-scrollbar max-h-[16rem] overflow-x-hidden overflow-y-auto px-2 py-2">
          <div className="space-y-1.5">
            {filteredTasks.map((task) => (
              <TaskQueueTaskRow
                key={task.id}
                task={task}
                now={now}
                modelDisplayName={modelNameById.get(task.model) || task.model}
                queuePosition={getTaskQueuePosition(tasks, task.id)}
                activeProjectId={activeProjectId}
                projectName={projectNameById.get(task.projectId ?? "") ?? null}
                onLocateResult={handleLocateResult}
              />
            ))}
          </div>
        </div>
      ) : tasks.length > 0 ? (
        <div
          className={`flex min-h-24 items-center justify-center px-4 text-center text-xs ${themeClasses.textMuted}`}
        >
          {TASK_QUEUE_COPY.filterEmpty}
        </div>
      ) : (
        <div
          data-testid="task-queue-empty"
          className={`flex min-h-16 flex-col items-center justify-center gap-1 px-4 text-center ${themeClasses.textMuted}`}
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--control-bg)] text-[var(--text-muted)]">
            <ListTodo className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs">{TASK_QUEUE_COPY.panelEmpty}</span>
        </div>
      )}
    </div>
  );
}
