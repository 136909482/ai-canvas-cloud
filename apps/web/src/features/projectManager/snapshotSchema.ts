import type { ProjectRecord, ProjectSnapshot, WorkspaceData } from "@/types";

export const CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseProjectSnapshot(value: unknown): ProjectSnapshot {
  if (!isRecord(value)) throw new Error("项目快照格式无效");
  if (value.schemaVersion !== CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("项目快照版本不受支持");
  }
  if (
    !isRecord(value.canvas) ||
    !Array.isArray(value.canvas.nodes) ||
    !Array.isArray(value.canvas.edges) ||
    !isRecord(value.taskQueue) ||
    !Array.isArray(value.taskQueue.tasks)
  ) {
    throw new Error("项目快照格式无效");
  }
  return value as unknown as ProjectSnapshot;
}

export function parseProjectRecordSnapshots(
  project: ProjectRecord,
): ProjectRecord {
  return {
    ...project,
    savedSnapshot: parseProjectSnapshot(project.savedSnapshot),
    workingSnapshot: parseProjectSnapshot(project.workingSnapshot),
  };
}

export function parseWorkspaceDataSnapshots(
  data: WorkspaceData,
): WorkspaceData {
  return {
    ...data,
    projects: data.projects.map(parseProjectRecordSnapshots),
  };
}
