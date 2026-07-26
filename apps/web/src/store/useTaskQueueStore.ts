import { create } from "zustand";
import {
  createTaskDisplayId,
  mergeTaskSnapshot,
  recoverTasksAfterSnapshotLoad,
  sanitizeTasks,
  type GenerateTaskSnapshot,
} from "@/features/generateQueue/taskQueueSnapshot";
import type {
  GenerateTask,
  GenerateTaskPhase,
  GenerateTaskRemoteStatus,
  TaskQueueSnapshot,
} from "@/types";

interface TaskQueueStore {
  tasks: GenerateTask[];
  runtimeVersion: number;
  createTask: (input: GenerateTaskSnapshot) => string;
  getSnapshot: () => TaskQueueSnapshot;
  replaceSnapshot: (
    snapshot: TaskQueueSnapshot,
    projectId?: string | null,
  ) => void;
  resetToEmpty: () => void;
  clearDeviceCache: () => void;
  claimTask: (id: string) => GenerateTask | null;
  bindTaskProvider: (
    id: string,
    binding: Pick<
      GenerateTaskSnapshot,
      | "apiProfileId"
      | "apiProfileName"
      | "provider"
      | "executionMode"
      | "adapterId"
      | "providerBindingFingerprint"
    >,
  ) => void;
  markTaskQueued: (id: string, patch?: Partial<GenerateTaskSnapshot>) => void;
  markTaskRunning: (id: string, previewNodeId?: string | null) => void;
  resumePersistingTask: (id: string) => void;
  setTaskPhase: (id: string, phase: GenerateTaskPhase) => void;
  queueRemoteTask: (id: string) => void;
  resumeRemoteTask: (id: string) => void;
  attachRemoteTask: (id: string, remoteTaskId: string) => void;
  attachTelemetryAttempt: (
    id: string,
    attemptId: string,
    startedAt: number,
  ) => void;
  setRemoteTaskStatus: (
    id: string,
    remoteStatus: GenerateTaskRemoteStatus,
  ) => void;
  markTaskDone: (id: string, patch?: Partial<GenerateTaskSnapshot>) => void;
  markTaskError: (id: string, errorMsg: string) => void;
  markTaskPersistError: (id: string, errorMsg: string) => void;
  removeTask: (id: string) => void;
  clearFinishedTasks: () => void;
}

let taskIdCounter = 1;

function createTaskId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  return `task-${Date.now()}-${taskIdCounter++}`;
}

function syncTaskIdCounter(tasks: GenerateTask[]) {
  const maxTaskId = tasks.reduce((maxValue, task) => {
    const match = /^task-(\d+)$/.exec(task.id);
    const numericId = match ? Number(match[1]) : 0;
    return Math.max(maxValue, numericId);
  }, 0);

  taskIdCounter = maxTaskId + 1;
}

export const useTaskQueueStore = create<TaskQueueStore>((set, get) => ({
  tasks: [],
  runtimeVersion: 0,

  createTask: (input) => {
    const taskId = createTaskId();
    const now = Date.now();
    const displayId = createTaskDisplayId(`${taskId}:${now}:${input.prompt}`);

    set((state) => ({
      tasks: [
        ...state.tasks,
        {
          id: taskId,
          displayId,
          projectId: input.projectId ?? null,
          kind: input.kind ?? "image",
          sourceNodeId: input.sourceNodeId,
          previewNodeId: input.previewNodeId ?? null,
          model: input.model,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt ?? "",
          ratio: input.ratio ?? "1:1",
          resolution: input.resolution ?? "1K",
          operationType:
            input.operationType ??
            (input.referenceImageUrls?.length
              ? "image-to-image"
              : "text-to-image"),
          sourceImageNodeId: input.sourceImageNodeId ?? null,
          maskImageUrl: input.maskImageUrl ?? null,
          apiProfileId: input.apiProfileId ?? null,
          apiProfileName: input.apiProfileName ?? null,
          provider: input.provider ?? null,
          referenceImageUrls: input.referenceImageUrls ?? [],
          inputFidelity: input.inputFidelity ?? null,
          quality: input.quality ?? null,
          googleSearch: Boolean(input.googleSearch),
          googleImageSearch: Boolean(input.googleImageSearch),
          videoMode: input.videoMode ?? null,
          videoDuration: input.videoDuration ?? null,
          resultImageAsset: input.resultImageAsset ?? null,
          resultVideoAsset: input.resultVideoAsset ?? null,
          status: "queued",
          phase: input.phase ?? null,
          executionMode: input.executionMode ?? null,
          adapterId: input.adapterId ?? null,
          providerBindingFingerprint: input.providerBindingFingerprint ?? null,
          errorMsg: "",
          remoteTaskId: null,
          remoteStatus: null,
          telemetryAttemptId: input.telemetryAttemptId ?? null,
          telemetryStartedAt: input.telemetryStartedAt ?? null,
          createdAt: now,
          startedAt: 0,
          finishedAt: null,
        },
      ],
    }));

    return taskId;
  },

  getSnapshot: (): TaskQueueSnapshot => ({
    tasks: sanitizeTasks(get().tasks),
  }),

  replaceSnapshot: (snapshot, projectId) =>
    set((state) => {
      const tasks = recoverTasksAfterSnapshotLoad(
        sanitizeTasks(snapshot.tasks ?? [], projectId),
        projectId,
      );
      syncTaskIdCounter(tasks);

      return {
        tasks,
        runtimeVersion: state.runtimeVersion + 1,
      };
    }),

  resetToEmpty: () =>
    set((state) => {
      taskIdCounter = 1;
      return {
        tasks: [],
        runtimeVersion: state.runtimeVersion + 1,
      };
    }),

  clearDeviceCache: () =>
    set((state) => ({
      tasks: [],
      runtimeVersion: state.runtimeVersion + 1,
    })),

  claimTask: (id) => {
    let claimedTask: GenerateTask | null = null;

    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== id || task.status !== "queued") {
          return task;
        }

        claimedTask = {
          ...task,
          status: "running",
          phase:
            task.phase === "persisting" || task.phase === "polling"
              ? task.phase
              : "requesting",
          startedAt: Date.now(),
          finishedAt: null,
          errorMsg: "",
          ...(task.phase === "persisting" || task.phase === "polling"
            ? {}
            : { remoteTaskId: null, remoteStatus: null }),
        };
        return claimedTask;
      }),
    }));

    return claimedTask;
  },

  bindTaskProvider: (id, binding) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? mergeTaskSnapshot(task, binding) : task,
      ),
    })),

  markTaskQueued: (id, patch) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...mergeTaskSnapshot(task, patch),
              status: "queued",
              phase: null,
              errorMsg: "",
              remoteTaskId: null,
              remoteStatus: null,
              telemetryAttemptId: null,
              telemetryStartedAt: null,
              createdAt: Date.now(),
              startedAt: 0,
              finishedAt: null,
            }
          : task,
      ),
    })),

  markTaskRunning: (id, previewNodeId) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "running",
              phase: "requesting",
              previewNodeId: previewNodeId ?? task.previewNodeId,
              startedAt: Date.now(),
              finishedAt: null,
              errorMsg: "",
              remoteTaskId: null,
              remoteStatus: null,
            }
          : task,
      ),
    })),

  resumePersistingTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "queued",
              phase: "persisting",
              errorMsg: "",
              startedAt: 0,
              finishedAt: null,
            }
          : task,
      ),
    })),

  setTaskPhase: (id, phase) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, phase } : task,
      ),
    })),

  queueRemoteTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "queued",
              phase: "polling",
              remoteStatus: "IN_PROGRESS",
              errorMsg: "",
              startedAt: 0,
              finishedAt: null,
            }
          : task,
      ),
    })),

  resumeRemoteTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "running",
              phase: "polling",
              startedAt: Date.now(),
              finishedAt: null,
              errorMsg: "",
              remoteStatus: "IN_PROGRESS",
            }
          : task,
      ),
    })),

  attachRemoteTask: (id, remoteTaskId) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              remoteTaskId,
              phase: "polling",
              remoteStatus: "IN_PROGRESS",
            }
          : task,
      ),
    })),

  attachTelemetryAttempt: (id, attemptId, startedAt) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              telemetryAttemptId: attemptId,
              telemetryStartedAt: startedAt,
            }
          : task,
      ),
    })),

  setRemoteTaskStatus: (id, remoteStatus) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              remoteStatus,
            }
          : task,
      ),
    })),

  markTaskDone: (id, patch) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...mergeTaskSnapshot(task, patch),
              status: "done",
              phase: null,
              remoteStatus: task.remoteTaskId ? "SUCCESS" : task.remoteStatus,
              finishedAt: Date.now(),
              errorMsg: "",
            }
          : task,
      ),
    })),

  markTaskPersistError: (id, errorMsg) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "error",
              phase: "persisting",
              remoteStatus: task.remoteTaskId ? "SUCCESS" : task.remoteStatus,
              errorMsg,
              finishedAt: Date.now(),
            }
          : task,
      ),
    })),

  markTaskError: (id, errorMsg) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "error",
              remoteStatus: task.remoteTaskId ? "FAILURE" : task.remoteStatus,
              errorMsg,
              finishedAt: Date.now(),
            }
          : task,
      ),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
    })),

  clearFinishedTasks: () =>
    set((state) => ({
      tasks: state.tasks.filter(
        (task) => task.status === "queued" || task.status === "running",
      ),
    })),
}));
