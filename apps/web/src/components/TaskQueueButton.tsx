import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ListTodo, LoaderCircle } from "lucide-react";
import { TaskQueueIconButton } from "@/components/TaskQueueIconButton";
import { TaskQueuePanel } from "@/components/TaskQueuePanel";
import { TASK_QUEUE_COPY } from "@/components/taskQueueCopy";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";

export function TaskQueueButton() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useDialogFocus<HTMLDivElement>(open, () => setOpen(false));
  const activeTaskCount = useTaskQueueStore(
    (state) =>
      state.tasks.filter(
        (task) => task.status === "queued" || task.status === "running",
      ).length,
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, panelRef]);

  return (
    <div
      ref={rootRef}
      className="relative [--font-mono:'JetBrains_Mono','Cascadia_Mono','Consolas',monospace]"
    >
      <TaskQueueIconButton
        label={TASK_QUEUE_COPY.openTasks}
        onClick={() => setOpen((current) => !current)}
        testId="task-queue-button"
        className="relative text-[var(--text-muted)]"
        tooltipPlacement="bottom"
        expanded={open}
        controls={open ? "task-queue-panel" : undefined}
        hasPopup="dialog"
        icon={
          <>
            {activeTaskCount > 0 ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ListTodo className="h-3.5 w-3.5" />
            )}
            {activeTaskCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-[var(--panel-bg-strong)] bg-[var(--accent-violet)] px-1 text-[8px] font-semibold leading-none text-white shadow">
                {activeTaskCount}
              </span>
            ) : null}
          </>
        }
      />

      {open && typeof document !== "undefined"
        ? createPortal(
            <TaskQueuePanel
              panelRef={panelRef}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
