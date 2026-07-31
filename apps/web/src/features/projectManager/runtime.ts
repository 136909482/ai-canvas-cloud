import { useCanvasStore } from "@/store/useCanvasStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import type { ProjectSnapshot } from "@/types";
import { cloneSerializable } from "@/utils/clone";
import {
  CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION,
  parseProjectSnapshot,
} from "./snapshotSchema";
import {
  sanitizeProjectSnapshotForPersistence,
  stripLocalTaskQueueFromProjectSnapshot,
} from "./snapshotSize";

export const DEFAULT_PROJECT_NAME = "未命名项目";
export { CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION, parseProjectSnapshot };

export function createEmptyProjectSnapshot(): ProjectSnapshot {
  return {
    schemaVersion: CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION,
    canvas: {
      nodes: [],
      edges: [],
    },
    taskQueue: {
      tasks: [],
    },
  };
}

export function cloneProjectSnapshot(
  snapshot: ProjectSnapshot,
): ProjectSnapshot {
  return parseProjectSnapshot(cloneSerializable(snapshot));
}

export function takeWorkspaceSnapshot(): ProjectSnapshot {
  return sanitizeProjectSnapshotForPersistence(
    cloneProjectSnapshot({
      schemaVersion: CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION,
      canvas: useCanvasStore.getState().getSnapshot(),
      taskQueue: useTaskQueueStore.getState().getSnapshot(),
    }),
  );
}

export function replaceWorkspaceSnapshot(
  snapshot: ProjectSnapshot,
  projectId?: string | null,
) {
  const clonedSnapshot = cloneProjectSnapshot(snapshot);
  useCanvasStore.getState().replaceSnapshot(clonedSnapshot.canvas);
  useTaskQueueStore
    .getState()
    .replaceSnapshot(clonedSnapshot.taskQueue, projectId);
}

export function resetWorkspaceToEmpty() {
  useCanvasStore.getState().resetToEmpty();
  useTaskQueueStore.getState().resetToEmpty();
}

export function serializeProjectSnapshot(snapshot: ProjectSnapshot) {
  return JSON.stringify(
    stripLocalTaskQueueFromProjectSnapshot(cloneProjectSnapshot(snapshot)),
  );
}
