import { lazy, Suspense } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { FolderKanban, Plus } from "lucide-react";
import { AppFeedbackHost } from "@/components/AppFeedbackHost";
import { Canvas } from "@/components/Canvas";
import { CanvasQuickActions } from "@/components/CanvasTopBar";
import { FloatingToolbar } from "@/components/FloatingToolbar";
import { NotificationCenterButton } from "@/components/NotificationCenterButton";
import { ProjectBootstrap } from "@/components/ProjectBootstrap";
import { ProjectConflictBanner } from "@/components/ProjectConflictBanner";
import { TaskQueueRunner } from "@/components/TaskQueueRunner";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TooltipIconButton } from "@/components/TooltipIconButton";
import { Toolbar } from "@/components/Toolbar";
import { AccountMenu } from "@/features/auth/AccountMenu";
import { AuthGate } from "@/features/auth/AuthGate";
import { useImageEditorStore } from "@/store/useImageEditorStore";
import { useProjectDialogStore } from "@/store/useProjectDialogStore";
import { useProjectStore } from "@/store/useProjectStore";
import { themeClasses } from "@/styles/themeClasses";

const ImageFullscreenEditor = lazy(() =>
  import("@/components/ImageFullscreenEditor").then((module) => ({
    default: module.ImageFullscreenEditor,
  })),
);
const ProjectManagerDialog = lazy(() =>
  import("@/components/ProjectManagerDialog").then((module) => ({
    default: module.ProjectManagerDialog,
  })),
);
function EmptyProjectHint() {
  const openProjectDialog = useProjectDialogStore((state) => state.open);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4">
      <div
        className={`pointer-events-auto w-full max-w-md rounded-lg p-6 text-center ${themeClasses.strongPanel}`}
      >
        <div className={`text-lg font-semibold ${themeClasses.textPrimary}`}>
          还没有项目
        </div>
        <p className={`mt-2 text-sm leading-6 ${themeClasses.textMuted}`}>
          现在可以创建你的第一个项目。
        </p>
        <button
          type="button"
          onClick={openProjectDialog}
          data-testid="empty-project-create"
          className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          新建项目
        </button>
      </div>
    </div>
  );
}

function AppContent() {
  const hasHydrated = useProjectStore((state) => state.hasHydrated);
  const isReady = useProjectStore((state) => state.isReady);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const imageEditorSession = useImageEditorStore((state) => state.session);
  const openProjectDialog = useProjectDialogStore((state) => state.open);

  if (!hasHydrated || !isReady) {
    return (
      <div
        className={`flex min-h-screen items-center justify-center text-sm ${themeClasses.canvas} ${themeClasses.textMuted}`}
      >
        正在加载项目...
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className={`w-screen h-screen relative ${themeClasses.canvas}`}>
        <Toolbar
          rightSlot={
            <>
              <CanvasQuickActions includeWorkflowActions={false} />
              <NotificationCenterButton />
              <TooltipIconButton
                label="项目管理"
                onClick={openProjectDialog}
                testId="project-manager-button"
                tooltipPlacement="bottom"
                className={`${themeClasses.iconButton} h-6 w-6 rounded-md`}
                icon={<FolderKanban className="h-3.5 w-3.5" />}
              />
              <AccountMenu />
            </>
          }
        />
        <FloatingToolbar />
        <ProjectConflictBanner />
        <TaskQueueRunner />
        <Canvas />
        {imageEditorSession ? (
          <Suspense fallback={null}>
            <ImageFullscreenEditor
              key={`${imageEditorSession.nodeId}\u0000${imageEditorSession.imageUrl}`}
            />
          </Suspense>
        ) : null}
        {!activeProjectId ? <EmptyProjectHint /> : null}
      </div>
    </ReactFlowProvider>
  );
}

function ProjectManagerDialogHost() {
  const isOpen = useProjectDialogStore((state) => state.isOpen);

  if (!isOpen) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <ProjectManagerDialog />
    </Suspense>
  );
}

export default function App() {
  return (
    <>
      <ThemeProvider />
      <AuthGate>
        <ProjectBootstrap />
        <AppContent />
        <ProjectManagerDialogHost />
      </AuthGate>
      <AppFeedbackHost />
    </>
  );
}
