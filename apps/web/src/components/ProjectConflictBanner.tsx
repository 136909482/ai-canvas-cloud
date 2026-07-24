import { useState } from "react";
import { AlertTriangle, Copy, Loader2, RefreshCw, X } from "lucide-react";
import { useFeedbackStore } from "@/store/useFeedbackStore";
import { useProjectStore } from "@/store/useProjectStore";
import { themeClasses } from "@/styles/themeClasses";

export function ProjectConflictBanner() {
  const conflict = useProjectStore((state) =>
    state.getActivePersistenceConflict(),
  );
  const reloadFromWorkspace = useProjectStore(
    (state) => state.reloadFromWorkspace,
  );
  const duplicateProject = useProjectStore((state) => state.duplicateProject);
  const loadProject = useProjectStore((state) => state.loadProject);
  const clearPersistenceConflict = useProjectStore(
    (state) => state.clearPersistenceConflict,
  );
  const confirm = useFeedbackStore((state) => state.confirm);
  const notify = useFeedbackStore((state) => state.notify);
  const [busyAction, setBusyAction] = useState<"reload" | "copy" | null>(null);

  if (!conflict) {
    return null;
  }

  const versionText =
    conflict.currentVersion === null
      ? null
      : `云端版本 ${conflict.currentVersion}${conflict.currentSequence === null ? "" : ` / 序列 ${conflict.currentSequence}`}`;

  const handleReload = async () => {
    const confirmed = await confirm({
      title: "重新加载云端版本",
      message:
        "这会丢弃当前画布里尚未上传的本地修改，并载入云端最新版本。确定继续吗？",
      confirmLabel: "重新加载",
      cancelLabel: "取消",
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    setBusyAction("reload");
    try {
      await reloadFromWorkspace();
      notify({
        tone: "success",
        title: "已加载云端版本",
        message: "当前画布已刷新到云端最新项目。",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "重新加载失败",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopy = async () => {
    setBusyAction("copy");
    try {
      const newProjectId = await duplicateProject(conflict.projectId);

      if (!newProjectId) {
        notify({
          tone: "warning",
          title: "另存失败",
          message: "当前项目不可用，无法创建副本。",
        });
        return;
      }

      await loadProject(newProjectId);
      clearPersistenceConflict(conflict.projectId);
      notify({
        tone: "success",
        title: "已另存为副本",
        message: "本地画布已保存到新项目，可以继续编辑。",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "另存副本失败",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-16 z-40 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2">
      <section
        role="status"
        aria-live="polite"
        data-testid="project-conflict-banner"
        className={`pointer-events-auto flex flex-col gap-3 rounded-lg border border-amber-400/30 bg-amber-50/95 p-3 shadow-[var(--shadow-panel)] backdrop-blur-xl dark:bg-amber-950/85 md:flex-row md:items-center ${themeClasses.textPrimary}`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-400/30 bg-amber-400/12 text-amber-700 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">云端项目已更新</div>
            <div
              className={`mt-1 text-xs leading-5 ${themeClasses.textSecondary}`}
            >
              {conflict.message}
              {versionText ? (
                <span className="ml-2 whitespace-nowrap">{versionText}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-11 md:pl-0">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleReload()}
            className={`${themeClasses.secondaryButton} inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {busyAction === "reload" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            重新加载
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleCopy()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyAction === "copy" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            另存副本
          </button>
          <button
            type="button"
            aria-label="稍后处理"
            disabled={isBusy}
            onClick={() => clearPersistenceConflict(conflict.projectId)}
            className={`${themeClasses.iconButton} h-8 w-8 shrink-0 disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
}
