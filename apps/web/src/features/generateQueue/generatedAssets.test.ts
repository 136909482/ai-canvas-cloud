import assert from "node:assert/strict";
import test from "node:test";
import type { GenerateTask } from "@/types";
import {
  buildGeneratedImageFileName,
  buildGeneratedVideoFileName,
  resolveGeneratedAssetProjectId,
} from "./generatedAssets.ts";

test("generated asset names never contain a private model id", () => {
  const task = {
    id: "task-opaque-id",
    model: "private/provider-model-id",
  } as GenerateTask;

  const imageName = buildGeneratedImageFileName(task, "image/webp");
  const videoName = buildGeneratedVideoFileName(task, "video/quicktime");

  assert.equal(imageName, "generated-task-opaque-id.webp");
  assert.equal(videoName, "generated-task-opaque-id.mov");
  assert.equal(`${imageName}${videoName}`.includes(task.model), false);
});

test("generated assets prefer the task project and recover legacy tasks from the active project", () => {
  assert.equal(
    resolveGeneratedAssetProjectId("project-task", "project-active"),
    "project-task",
  );
  assert.equal(
    resolveGeneratedAssetProjectId(null, "project-active"),
    "project-active",
  );
  assert.equal(resolveGeneratedAssetProjectId("  ", "  "), null);
});
