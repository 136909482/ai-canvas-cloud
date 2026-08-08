import { useEffect, useRef, useState } from "react";
import { platformBridge } from "@/platform";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { useAuthStore } from "@/features/auth/useAuthStore";
import type { CanvasSnapshot } from "@/types";
import { hasGraphDeletion } from "@/features/projectManager/projectAutosave";
import { hasInterruptibleSynchronousImageTask } from "@/features/generateQueue/taskQueueView";
import { themeClasses } from "@/styles/themeClasses";

const AUTOSAVE_IDLE_TIMEOUT_MS = 2_000;
const PROJECT_BOOTSTRAP_TIMEOUT_MS = 12_000;

function hasDraggingNode({ nodes }: CanvasSnapshot) {
  return nodes.some((node) => node.dragging);
}

export function ProjectBootstrap() {
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const workspaceId = useAuthStore(
    (state) => state.session?.workspace.id ?? null,
  );
  const isReady = useProjectStore((state) => state.isReady);
  const hasHydrated = useProjectStore((state) => state.hasHydrated);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const ensureInitialized = useProjectStore((state) => state.ensureInitialized);
  const persistWorkspaceFile = useProjectStore(
    (state) => state.persistWorkspaceFile,
  );
  const autosaveIntervalMs = useSettingsStore(
    (state) => state.config.storage.autosaveIntervalMs,
  );
  const workspaceConfigured = useSettingsStore(
    (state) => state.runtime.workspaceConfigured,
  );
  const settingsHydrated = useSettingsStore((state) => state.runtime.hydrated);
  const setWorkspaceRuntimeStatus = useSettingsStore(
    (state) => state.setWorkspaceRuntimeStatus,
  );
  const hydrateFromWorkspace = useSettingsStore(
    (state) => state.hydrateFromWorkspace,
  );
  const hydrateLocalVault = useSettingsStore(
    (state) => state.hydrateLocalVault,
  );
  const persistLocalTaskQueue = useSettingsStore(
    (state) => state.persistLocalTaskQueue,
  );
  const vaultPersistence = useSettingsStore(
    (state) => state.runtime.vaultPersistence,
  );
  const vaultUserId = useSettingsStore((state) => state.runtime.vaultUserId);
  const [retryCount, setRetryCount] = useState(0);
  const [bootstrapState, setBootstrapState] = useState<
    "idle" | "loading" | "error" | "timed-out"
  >("idle");
  const initializedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !workspaceId) {
      setBootstrapState("idle");
      return;
    }

    const sessionKey = `${userId}\n${workspaceId}`;
    const attemptKey = `${sessionKey}\n${retryCount}`;
    if (initializedSessionRef.current === attemptKey) return;
    initializedSessionRef.current = attemptKey;

    let cancelled = false;
    setBootstrapState("loading");
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setBootstrapState("timed-out");
    }, PROJECT_BOOTSTRAP_TIMEOUT_MS);

    void (async () => {
      try {
        const status = await platformBridge.getWorkspaceStatus();
        setWorkspaceRuntimeStatus({
          configured: status.configured,
          directoryName: status.directoryName,
          permission: status.permission,
        });
      } catch {
        setWorkspaceRuntimeStatus({
          configured: false,
          directoryName: "",
          permission: "prompt",
        });
      }

      if (cancelled) return;
      await hydrateFromWorkspace(userId, workspaceId);
      if (cancelled) return;
      await hydrateLocalVault(userId);
      if (cancelled) return;
      await ensureInitialized();
      if (!cancelled) setBootstrapState("idle");
    })()
      .catch(() => {
        if (!cancelled) setBootstrapState("error");
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    ensureInitialized,
    hydrateFromWorkspace,
    hydrateLocalVault,
    retryCount,
    setWorkspaceRuntimeStatus,
    userId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    const handleRunningGenerationBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !hasInterruptibleSynchronousImageTask(
          useTaskQueueStore.getState().tasks,
        )
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener(
      "beforeunload",
      handleRunningGenerationBeforeUnload,
    );
    return () => {
      window.removeEventListener(
        "beforeunload",
        handleRunningGenerationBeforeUnload,
      );
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!settingsHydrated || !hasHydrated || !isReady || workspaceConfigured) {
      return;
    }

    const handleBeforeUnloadWithoutWorkspace = (event: BeforeUnloadEvent) => {
      if (!useProjectStore.getState().hasUnsavedChanges()) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnloadWithoutWorkspace);

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnloadWithoutWorkspace,
      );
    };
  }, [hasHydrated, isReady, settingsHydrated, workspaceConfigured]);

  useEffect(() => {
    if (
      !settingsHydrated ||
      !hasHydrated ||
      !isReady ||
      !activeProjectId ||
      !workspaceConfigured
    ) {
      return;
    }

    let debounceId: number | null = null;
    let cancelScheduledIdleSave: (() => void) | null = null;
    let isPersisting = false;
    let pendingAfterPersist = false;

    const cancelIdleSave = () => {
      if (!cancelScheduledIdleSave) {
        return;
      }

      cancelScheduledIdleSave();
      cancelScheduledIdleSave = null;
    };

    const cancelDebounce = () => {
      if (debounceId === null) {
        return;
      }

      window.clearTimeout(debounceId);
      debounceId = null;
    };

    const runAutosave = () => {
      cancelScheduledIdleSave = null;

      if (isPersisting) {
        pendingAfterPersist = true;
        return;
      }

      if (!useProjectStore.getState().hasPersistedChanges()) {
        return;
      }

      isPersisting = true;
      void persistWorkspaceFile()
        .catch(() => undefined)
        .finally(() => {
          isPersisting = false;

          if (pendingAfterPersist) {
            pendingAfterPersist = false;
            scheduleAutosave();
          }
        });
    };

    const scheduleIdleSave = () => {
      cancelIdleSave();
      const idleScheduler = globalThis as typeof globalThis & {
        requestIdleCallback?: Window["requestIdleCallback"];
        cancelIdleCallback?: Window["cancelIdleCallback"];
      };

      if (
        idleScheduler.requestIdleCallback &&
        idleScheduler.cancelIdleCallback
      ) {
        const idleId = idleScheduler.requestIdleCallback(runAutosave, {
          timeout: AUTOSAVE_IDLE_TIMEOUT_MS,
        });
        cancelScheduledIdleSave = () =>
          idleScheduler.cancelIdleCallback?.(idleId);
        return;
      }

      const timeoutId = globalThis.setTimeout(runAutosave, 0);
      cancelScheduledIdleSave = () => globalThis.clearTimeout(timeoutId);
    };

    function scheduleAutosave() {
      cancelDebounce();
      cancelIdleSave();
      debounceId = window.setTimeout(() => {
        debounceId = null;
        scheduleIdleSave();
      }, autosaveIntervalMs);
    }

    scheduleAutosave();

    const flushAutosave = () => {
      cancelDebounce();
      cancelIdleSave();
      runAutosave();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushAutosave();
      }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useProjectStore.getState().hasPersistedChanges()) {
        return;
      }

      flushAutosave();
      event.preventDefault();
      event.returnValue = "";
    };

    const unsubscribeCanvas = useCanvasStore.subscribe(
      (state, previousState) => {
        if (hasDraggingNode(state) || hasDraggingNode(previousState)) {
          if (hasDraggingNode(state)) {
            return;
          }
        }

        if (hasGraphDeletion(state, previousState)) {
          cancelDebounce();
          scheduleIdleSave();
          return;
        }

        scheduleAutosave();
      },
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushAutosave);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsubscribeCanvas();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushAutosave);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      cancelDebounce();
      cancelIdleSave();
    };
  }, [
    activeProjectId,
    autosaveIntervalMs,
    hasHydrated,
    isReady,
    persistWorkspaceFile,
    settingsHydrated,
    workspaceConfigured,
  ]);

  useEffect(() => {
    if (
      !settingsHydrated ||
      !hasHydrated ||
      !isReady ||
      !activeProjectId ||
      !vaultUserId
    ) {
      return;
    }

    const persistCurrentTaskQueue = () => {
      void persistLocalTaskQueue(
        activeProjectId,
        useTaskQueueStore.getState().getSnapshot(),
      ).catch(() => undefined);
    };

    persistCurrentTaskQueue();
    const unsubscribe = useTaskQueueStore.subscribe(persistCurrentTaskQueue);
    return unsubscribe;
  }, [
    activeProjectId,
    hasHydrated,
    isReady,
    persistLocalTaskQueue,
    settingsHydrated,
    vaultPersistence,
    vaultUserId,
  ]);

  if (bootstrapState === "error" || bootstrapState === "timed-out") {
    return (
      <div
        role="alert"
        className={`fixed inset-0 z-[10000] flex items-center justify-center px-4 ${themeClasses.canvas}`}
      >
        <div
          className={`w-full max-w-md rounded-xl p-6 text-center ${themeClasses.strongPanel}`}
        >
          <div
            className={`text-base font-semibold ${themeClasses.textPrimary}`}
          >
            项目加载遇到问题
          </div>
          <p className={`mt-2 text-sm leading-6 ${themeClasses.textMuted}`}>
            {bootstrapState === "timed-out"
              ? "初始化等待时间较长，可能是 Cloud 服务暂时没有响应。"
              : "项目初始化没有完成，可能是 Cloud 服务暂时不可用。"}
          </p>
          <button
            type="button"
            onClick={() => {
              useProjectStore.getState().resetForSession();
              setBootstrapState("loading");
              setRetryCount((value) => value + 1);
            }}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-violet-500 px-4 text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            重新加载项目
          </button>
        </div>
      </div>
    );
  }

  return null;
}
