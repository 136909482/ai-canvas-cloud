import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  Download,
  Loader2,
  Plus,
  FolderKanban,
  MoreHorizontal,
  Save,
  Timer,
  Upload,
} from "lucide-react";
import { hasInterruptibleSynchronousImageTask } from "@/features/generateQueue/taskQueueView";
import { handleMenuKeyboard } from "@/utils/menuKeyboard";
import { TooltipIconButton } from "@/components/TooltipIconButton";
import { confirmReturnHome } from "@/components/canvas/canvasHomeNavigation";
import { platformBridge } from "@/platform";
import { selectHasCanvasContent, useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useFeedbackStore } from "@/store/useFeedbackStore";
import { useProjectDialogStore } from "@/store/useProjectDialogStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { useSettingsDialogStore } from "@/store/useSettingsDialogStore";
import { themeClasses } from "@/styles/themeClasses";
import type { ProjectPersistenceStatus } from "@/features/projectManager/persistenceStatus";

function getPersistenceIconView(status: ProjectPersistenceStatus) {
  switch (status.kind) {
    case "saving":
      return {
        label: "正在自动保存",
        Icon: Loader2,
        className: "animate-spin text-[var(--accent-violet-strong)]",
      };
    case "restoring":
      return {
        label: "正在恢复项目",
        Icon: Loader2,
        className: "animate-spin text-[var(--accent-violet-strong)]",
      };
    case "auto-saved":
      return {
        label: `已自动保存，${new Date(status.at).toLocaleTimeString("zh-CN")}`,
        Icon: CheckCircle2,
        className: "text-emerald-500 dark:text-emerald-300",
      };
    case "manual-saved":
      return {
        label: `已保存，${new Date(status.at).toLocaleTimeString("zh-CN")}`,
        Icon: CheckCircle2,
        className: "text-emerald-500 dark:text-emerald-300",
      };
    case "pending-autosave":
    case "auto-saved-manual-dirty":
      return {
        label: "等待自动保存",
        Icon: Timer,
        className: "text-amber-500 dark:text-amber-300",
      };
    case "error":
      return {
        label: `自动保存失败：${status.message}`,
        Icon: CloudOff,
        className: "text-red-500 dark:text-red-300",
      };
    case "storage-required":
      return {
        label: "云端存储暂未就绪",
        Icon: CloudOff,
        className: "text-amber-500 dark:text-amber-300",
      };
    case "no-project":
      return {
        label: "当前没有项目",
        Icon: CloudOff,
        className: themeClasses.textMuted,
      };
    default:
      return {
        label: "尚未自动保存",
        Icon: Timer,
        className: themeClasses.textMuted,
      };
  }
}

export function CanvasMoreMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node))
        setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);
  const closeMenu = () => {
    setIsOpen(false);
    buttonRef.current?.focus();
  };
  const openSettings = useSettingsDialogStore((state) => state.open);
  const activeProject = useProjectStore((state) => state.getActiveProject());
  const saveActiveProject = useProjectStore((state) => state.saveActiveProject);
  const isPersisting = useProjectStore((state) => state.isPersisting);
  const syncActiveWorkingSnapshot = useProjectStore(
    (state) => state.syncActiveWorkingSnapshot,
  );
  const getSnapshot = useCanvasStore((state) => state.getSnapshot);
  const replaceSnapshot = useCanvasStore((state) => state.replaceSnapshot);
  const hasCanvasContent = useCanvasStore(selectHasCanvasContent);
  const clearHistory = useHistoryStore((state) => state.clearHistory);
  const notify = useFeedbackStore((state) => state.notify);
  const confirm = useFeedbackStore((state) => state.confirm);

  const handleSaveProject = async () => {
    try {
      const result = await saveActiveProject();
      const thumbnailBackfillCount =
        useProjectStore.getState().lastThumbnailBackfillCount;

      if (result === "storage-required") {
        notify({
          tone: "warning",
          title: "需要缓存目录",
          message: "首次保存前请先设置缓存目录。",
        });
        openSettings("storage");
      } else if (result === "saved" && thumbnailBackfillCount > 0) {
        notify({
          tone: "success",
          title: "性能缩略图已生成",
          message: `已为旧项目补齐 ${thumbnailBackfillCount} 张画布缩略图，后续拖动画布会优先使用这些资源。`,
        });
      }
    } catch {
      // The project store reports the structured diagnostic and user feedback.
    }
  };

  const handleExportWorkflow = async () => {
    const suggestedName = `${activeProject?.name || "workflow"}.json`;
    await platformBridge.exportWorkflowJson(getSnapshot(), suggestedName);
  };

  const handleImportWorkflow = async () => {
    if (hasCanvasContent) {
      const confirmed = await confirm({
        title: "导入工作流",
        message: "导入工作流会替换当前画布，确定继续吗？",
        confirmLabel: "继续导入",
      });

      if (!confirmed) {
        return;
      }
    }

    try {
      const { snapshot } = await platformBridge.importWorkflowJson();
      replaceSnapshot(snapshot);
      clearHistory();
      syncActiveWorkingSnapshot();
    } catch (error) {
      if (error instanceof Error && error.message === "未选择工作流文件") {
        return;
      }

      notify({
        tone: "error",
        title: "导入失败",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const actions = [
    {
      label: "保存项目",
      testId: "save-project-button",
      Icon: Save,
      action: handleSaveProject,
      disabled: isPersisting,
    },
    {
      label: "导入工作流",
      testId: "import-workflow-button",
      Icon: Upload,
      action: handleImportWorkflow,
    },
    {
      label: "导出工作流",
      testId: "export-workflow-button",
      Icon: Download,
      action: handleExportWorkflow,
    },
    {
      label: "项目管理",
      testId: "project-manager-button",
      Icon: FolderKanban,
      action: () => useProjectDialogStore.getState().open(),
    },
  ];
  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="更多画布操作"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-testid="canvas-more-button"
        className={`${themeClasses.iconButton} h-8 w-8 rounded-md`}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            requestAnimationFrame(() =>
              menuRef.current
                ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                ?.focus(),
            );
          }
          if (event.key === "Escape") closeMenu();
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <div
        ref={menuRef}
        role="menu"
        aria-label="更多画布操作"
        hidden={!isOpen}
        className={`absolute right-0 top-[calc(100%+10px)] z-50 w-48 max-h-[calc(100dvh-5rem)] overflow-y-auto p-1 ${themeClasses.compactFloatingPanel}`}
        onKeyDown={(event) =>
          handleMenuKeyboard(event.nativeEvent, menuRef.current, closeMenu)
        }
      >
        {actions.map(({ label, testId, Icon, action, disabled }) => (
          <button
            key={testId}
            type="button"
            role="menuitem"
            data-testid={testId}
            disabled={disabled}
            onClick={() => {
              closeMenu();
              void action();
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] focus-visible:outline-none focus-visible:bg-[var(--control-bg-hover)] disabled:opacity-40"
          >
            <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CanvasTopBar() {
  const activeProject = useProjectStore((state) => state.getActiveProject());
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const loadProject = useProjectStore((state) => state.loadProject);
  const saveActiveProject = useProjectStore((state) => state.saveActiveProject);
  const getActivePersistenceStatus = useProjectStore(
    (state) => state.getActivePersistenceStatus,
  );
  const hasUnsavedChanges = useProjectStore((state) =>
    state.hasUnsavedChanges(),
  );
  const confirm = useFeedbackStore((state) => state.confirm);
  const notify = useFeedbackStore((state) => state.notify);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isSwitchingProject, setIsSwitchingProject] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectName = activeProject?.name || "未命名项目";
  const persistenceStatus = getActivePersistenceStatus();
  const status = getPersistenceIconView(persistenceStatus);

  useEffect(() => {
    if (!isProjectMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsProjectMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProjectMenuOpen]);

  const handleReturnHome = async () => {
    if (!(await confirmReturnHome(hasUnsavedChanges, confirm))) {
      return;
    }

    window.location.assign("/home");
  };

  const handleSwitchProject = async (projectId: string) => {
    if (projectId === activeProjectId || isSwitchingProject) {
      setIsProjectMenuOpen(false);
      return;
    }

    if (
      hasInterruptibleSynchronousImageTask(useTaskQueueStore.getState().tasks)
    ) {
      const confirmed = await confirm({
        title: "同步生成仍在运行",
        message:
          "切换项目会中断当前同步请求，但服务商仍可能完成生成并计费。确定继续吗？",
        confirmLabel: "继续切换",
      });
      if (!confirmed) return;
    }

    if (activeProjectId) {
      try {
        await useSettingsStore
          .getState()
          .persistLocalTaskQueue(
            activeProjectId,
            useTaskQueueStore.getState().getSnapshot(),
          );
      } catch (error) {
        notify({
          tone: "error",
          title: "任务队列保存失败",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    if (hasUnsavedChanges) {
      const shouldSave = await confirm({
        title: "保存当前改动",
        message: "当前项目有未保存的改动，是否先保存？",
        confirmLabel: "先保存",
        cancelLabel: "不保存",
      });
      if (shouldSave) {
        try {
          const result = await saveActiveProject();
          if (result !== "saved") {
            notify({
              tone: "warning",
              title: "无法保存当前项目",
              message: "请完成存储设置后再切换项目。",
            });
            return;
          }
        } catch {
          return;
        }
      } else if (
        !(await confirm({
          title: "放弃未保存改动",
          message: "不保存当前改动，继续切换吗？",
          confirmLabel: "继续切换",
          tone: "danger",
        }))
      ) {
        return;
      }
    }

    setIsSwitchingProject(true);
    try {
      const success = await loadProject(projectId);
      if (!success) {
        notify({
          tone: "error",
          title: "项目切换失败",
          message: "项目不可用或已被归档。",
        });
        return;
      }
      setIsProjectMenuOpen(false);
    } catch (error) {
      notify({
        tone: "error",
        title: "项目切换失败",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSwitchingProject(false);
    }
  };

  // 菜单只展示最近编辑的 5 个项目；当前项目不在其中时置顶补位。
  const RECENT_PROJECT_COUNT = 5;
  const availableProjects = projects.filter((project) => !project.archivedAt);
  const recentProjects = [...availableProjects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_PROJECT_COUNT);
  const activeInRecent = recentProjects.some(
    (project) => project.id === activeProjectId,
  );
  const visibleProjects =
    activeInRecent || !activeProject || activeProject.archivedAt
      ? recentProjects
      : [
          activeProject,
          ...recentProjects.filter((project) => project.id !== activeProjectId),
        ].slice(0, RECENT_PROJECT_COUNT);

  const openProjectCreate = () => {
    setIsProjectMenuOpen(false);
    useProjectDialogStore.getState().openCreate();
  };

  return (
    <div
      ref={projectMenuRef}
      className={`relative flex h-9 min-w-0 items-center gap-0.5 px-1 ${themeClasses.canvasTopPanel}`}
    >
      <TooltipIconButton
        label="返回首页"
        onClick={() => {
          void handleReturnHome();
        }}
        testId="return-home-button"
        tooltipAlign="start"
        className={`${themeClasses.iconButton} h-7 w-7 shrink-0 rounded-md`}
        icon={
          <img
            src="/brand/ai-canvas-mark.png"
            alt=""
            className="h-3.5 w-3.5 object-contain"
          />
        }
      />
      <span
        aria-hidden="true"
        className={`mx-0.5 h-4 w-px shrink-0 ${themeClasses.divider}`}
      />
      <button
        type="button"
        className={`flex h-7 min-w-0 max-w-36 sm:max-w-60 flex-1 items-center gap-2 rounded-md border border-transparent bg-transparent px-2 text-left text-xs font-medium ${themeClasses.textPrimary} transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-violet-soft)] disabled:cursor-not-allowed`}
        title="切换项目画布"
        aria-label={`当前项目：${projectName}，切换项目画布`}
        aria-haspopup="menu"
        aria-expanded={isProjectMenuOpen}
        onClick={() => setIsProjectMenuOpen((open) => !open)}
        disabled={isSwitchingProject}
      >
        <span className="min-w-0 truncate">{projectName}</span>
        <ChevronDown
          aria-hidden="true"
          className={`ml-auto mr-0.5 h-3.5 w-3.5 shrink-0 transition-transform ${isProjectMenuOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isProjectMenuOpen ? (
        <div
          role="menu"
          aria-label="项目画布"
          className={`absolute left-9 top-[calc(100%+6px)] z-50 max-h-[min(16rem,calc(100vh-8rem))] min-w-56 max-w-[calc(100vw-1rem)] overflow-y-auto p-1 ${themeClasses.compactFloatingPanel}`}
        >
          {visibleProjects.length ? (
            visibleProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                role="menuitem"
                className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition hover:bg-[var(--control-bg-hover)] ${project.id === activeProjectId ? "bg-[var(--accent-violet-soft)] font-semibold" : themeClasses.textPrimary}`}
                onClick={() => void handleSwitchProject(project.id)}
                disabled={isSwitchingProject}
              >
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.id === activeProjectId ? (
                  <Check
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-[var(--accent-violet-strong)]"
                  />
                ) : null}
              </button>
            ))
          ) : (
            <span
              className={`block px-2 py-1.5 text-xs ${themeClasses.textMuted}`}
            >
              暂无可用项目
            </span>
          )}
          <div
            aria-hidden="true"
            className="my-1 h-px bg-[var(--border-subtle)]"
          />
          <button
            type="button"
            role="menuitem"
            onClick={openProjectCreate}
            className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-[var(--accent-violet-strong)] transition hover:bg-[var(--control-bg-hover)]"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            新建项目
          </button>
        </div>
      ) : null}
      <span
        aria-hidden="true"
        className={`mx-0.5 h-4 w-px shrink-0 ${themeClasses.divider}`}
      />
      <span
        role="status"
        aria-label={status.label}
        title={status.label}
        data-testid="project-persistence-status"
        data-status-kind={persistenceStatus.kind}
        className="flex h-7 shrink-0 items-center justify-center gap-1.5 px-1"
      >
        <status.Icon
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${status.className}`}
        />
        <span className="hidden text-[10px] text-[var(--text-muted)] lg:inline">
          {persistenceStatus.kind === "saving"
            ? "保存中"
            : persistenceStatus.kind === "error"
              ? "同步失败"
              : persistenceStatus.kind === "auto-saved" ||
                  persistenceStatus.kind === "manual-saved"
                ? "已保存"
                : "待同步"}
        </span>
      </span>
    </div>
  );
}
