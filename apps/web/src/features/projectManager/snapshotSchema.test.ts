import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSnapshot, WorkspaceData } from "@/types";
import {
  CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION,
  parseProjectSnapshot,
  parseWorkspaceDataSnapshots,
} from "./snapshotSchema.ts";

const snapshot: ProjectSnapshot = {
  schemaVersion: CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION,
  canvas: { nodes: [], edges: [] },
  taskQueue: { tasks: [] },
};

test("accepts only the current complete project snapshot", () => {
  assert.equal(parseProjectSnapshot(snapshot), snapshot);
  for (const invalid of [
    { ...snapshot, schemaVersion: 0 },
    { ...snapshot, schemaVersion: 2 },
    { ...snapshot, canvas: { nodes: [] } },
    { ...snapshot, taskQueue: {} },
  ]) {
    assert.throws(() => parseProjectSnapshot(invalid), /快照/);
  }
});

test("validates saved and working snapshots in workspace data", () => {
  const data: WorkspaceData = {
    projects: [
      {
        id: "project-1",
        name: "Current project",
        savedSnapshot: snapshot,
        workingSnapshot: snapshot,
        createdAt: 1,
        updatedAt: 2,
        lastOpenedAt: 3,
      },
    ],
    activeProjectId: "project-1",
    lastOpenedProjectId: "project-1",
  };
  assert.equal(parseWorkspaceDataSnapshots(data).projects.length, 1);
});
