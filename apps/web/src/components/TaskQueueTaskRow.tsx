import {
  AlertCircle,
  CheckCircle2,
  ImageIcon,
  LocateFixed,
  LoaderCircle,
  RotateCcw,
  Trash2,
  Video,
  XCircle,
} from "lucide-react";
import { TaskQueueIconButton } from "@/components/TaskQueueIconButton";
import { TASK_QUEUE_COPY } from "@/components/taskQueueCopy";
import {
  cancelQueuedGenerateTask,
  removeGenerateTask,
  retryGenerateTask,
} from "@/features/generateQueue/orchestrator";
import {
  canCancelQueuedTask,
  getTaskProgressLabel,
} from "@/features/generateQueue/taskQueueView";
import type { GenerateTask } from "@/types";

type TaskQueueTaskRowProps = {
  task: GenerateTask;
  now: number;
  modelDisplayName: string;
  queuePosition: number | null;
  activeProjectId: string | null;
  projectName: string | null;
  onLocateResult: (task: GenerateTask) => void;
};

function formatDuration(task: GenerateTask, now: number) {
  const start = task.startedAt || task.createdAt;
  const end = task.finishedAt ?? now;
  const diffMs = Math.max(end - start, 0);
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getStatusMeta(task: GenerateTask) {
  if (task.status === "done") {
    return {
      label: TASK_QUEUE_COPY.done,
      pillClassName:
        "border-emerald-400/20 bg-emerald-400/8 text-emerald-600 dark:text-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" />,
    };
  }

  if (task.status === "error") {
    return {
      label: TASK_QUEUE_COPY.error,
      pillClassName:
        "border-red-400/25 bg-red-500/10 text-red-500 dark:text-red-200",
      icon: <AlertCircle className="h-3 w-3" />,
    };
  }

  if (task.status === "queued") {
    return {
      label: TASK_QUEUE_COPY.queued,
      pillClassName:
        "border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-200",
      icon: <LoaderCircle className="h-3 w-3" />,
    };
  }

  return {
    label: getTaskProgressLabel(task),
    pillClassName:
      "border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)]",
    icon: <LoaderCircle className="h-3 w-3 animate-spin" />,
  };
}

export function TaskQueueTaskRow({
  task,
  now,
  modelDisplayName,
  queuePosition,
  activeProjectId,
  projectName,
  onLocateResult,
}: TaskQueueTaskRowProps) {
  const statusMeta = getStatusMeta(task);
  const isCurrentProject = task.projectId === activeProjectId;

  return (
    <div
      data-testid={`task-row-${task.id}`}
      className="group/task grid min-h-10 min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--control-bg)] px-2 py-1.5 transition hover:bg-[var(--control-bg-hover)]"
      title={`${modelDisplayName} (${task.model}) ${task.displayId}`}
    >
      <span className="inline-flex h-5 w-12 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)] px-1 text-[11px] font-semibold leading-none text-[var(--accent-violet-strong)]">
        {task.kind === "video" ? (
          <Video className="h-3 w-3 shrink-0" />
        ) : (
          <ImageIcon className="h-3 w-3 shrink-0" />
        )}
        {task.kind === "video" ? TASK_QUEUE_COPY.video : TASK_QUEUE_COPY.image}
      </span>

      <span className="flex h-4 items-center overflow-visible">
        <span className="block translate-y-px font-mono text-[10px] font-medium leading-[1.2] text-[var(--text-muted)]">
          {task.displayId}
        </span>
      </span>

      <span className="flex h-5 min-w-0 items-center overflow-visible">
        <span className="block min-w-0 truncate text-xs font-medium leading-tight text-[var(--text-primary)]">
          {modelDisplayName}
        </span>
      </span>

      <div className="grid shrink-0 grid-cols-[1.25rem_2.75rem_3.5rem_1.5rem_1.5rem] items-center gap-1.5">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${
            task.status === "done"
              ? "text-emerald-300"
              : task.status === "error"
                ? "text-red-300"
                : "text-violet-300"
          }`}
        >
          {statusMeta.icon}
        </span>

        <span className="inline-flex w-11 items-center justify-end text-[11px] font-semibold leading-none tabular-nums text-[var(--text-secondary)]">
          {formatDuration(task, now)}
        </span>

        <span
          className={`inline-flex h-5 min-w-12 items-center justify-center gap-1 whitespace-nowrap rounded border px-1 text-[11px] font-semibold leading-none ${statusMeta.pillClassName}`}
        >
          {statusMeta.label}
        </span>

        <span className="flex h-6 w-6 items-center justify-center">
          {task.status === "done" && task.previewNodeId && isCurrentProject ? (
            <TaskQueueIconButton
              label={TASK_QUEUE_COPY.locateResult}
              onClick={() => onLocateResult(task)}
              testId={`locate-task-result-${task.id}`}
              showTooltip={false}
              icon={<LocateFixed className="h-3.5 w-3.5" />}
            />
          ) : task.status === "error" ? (
            <TaskQueueIconButton
              label={
                task.phase === "persisting"
                  ? TASK_QUEUE_COPY.continueSaving
                  : TASK_QUEUE_COPY.retryTask
              }
              onClick={() => retryGenerateTask(task.id)}
              testId={`retry-task-${task.id}`}
              showTooltip={false}
              icon={<RotateCcw className="h-3.5 w-3.5" />}
            />
          ) : canCancelQueuedTask(task) ? (
            <TaskQueueIconButton
              label={TASK_QUEUE_COPY.cancelQueued}
              onClick={() => cancelQueuedGenerateTask(task.id)}
              testId={`cancel-task-${task.id}`}
              showTooltip={false}
              className="hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-200"
              icon={<XCircle className="h-3.5 w-3.5" />}
            />
          ) : null}
        </span>

        <span className="flex h-6 w-6 items-center justify-center">
          {(task.status === "done" || task.status === "error") &&
            isCurrentProject && (
              <TaskQueueIconButton
                label={TASK_QUEUE_COPY.removeTask}
                onClick={() => void removeGenerateTask(task.id)}
                className="hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-200"
                showTooltip={false}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              />
            )}
        </span>
      </div>

      {!isCurrentProject ? (
        <span className="col-span-4 -mt-1 block min-w-0 truncate pl-14 text-[10px] leading-none text-[var(--text-muted)]">
          {projectName ?? TASK_QUEUE_COPY.otherProject}
        </span>
      ) : null}
      {task.status === "queued" && queuePosition ? (
        <span className="col-span-4 -mt-1 block min-w-0 truncate pl-14 text-[10px] leading-none text-[var(--text-muted)]">
          {TASK_QUEUE_COPY.queuePosition} {queuePosition}
        </span>
      ) : null}
      {task.status === "error" && task.errorMsg ? (
        <span className="col-span-4 -mt-1 break-words pl-14 text-[10px] leading-4 text-red-500 dark:text-red-200">
          {task.errorMsg}
        </span>
      ) : null}
    </div>
  );
}
