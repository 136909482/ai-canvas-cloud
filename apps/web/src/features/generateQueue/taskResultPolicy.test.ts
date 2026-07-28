import assert from "node:assert/strict";
import test from "node:test";
import type { GenerateTask } from "@/types";
import {
  canReuseTaskResultNode,
  selectLatestSuccessfulImageTask,
} from "./taskResultPolicy.ts";

function completedTask(id: string, createdAt: number): GenerateTask {
  return {
    id,
    displayId: id,
    projectId: "project-1",
    kind: "image",
    sourceNodeId: "source-1",
    previewNodeId: `preview-${id}`,
    model: "model-1",
    prompt: "prompt",
    negativePrompt: "",
    ratio: "1:1",
    resolution: "1K",
    operationType: "text-to-image",
    sourceImageNodeId: null,
    maskImageUrl: null,
    apiProfileId: null,
    apiProfileName: null,
    provider: "openai",
    referenceImages: [],
    referenceImageUrls: [],
    inputFidelity: null,
    quality: null,
    googleSearch: false,
    googleImageSearch: false,
    videoMode: null,
    videoDuration: null,
    resultImageAsset: null,
    resultVideoAsset: null,
    status: "done",
    errorMsg: "",
    remoteTaskId: null,
    remoteStatus: null,
    createdAt,
    startedAt: createdAt + 10,
    finishedAt: createdAt + 20,
  };
}

test("new clicks never reuse another task's empty result node", () => {
  assert.equal(
    canReuseTaskResultNode({ hasResult: false, taskId: null }),
    true,
  );
  assert.equal(
    canReuseTaskResultNode({ hasResult: false, taskId: "task-1" }),
    false,
  );
  assert.equal(
    canReuseTaskResultNode({ hasResult: false, taskId: "task-1" }, "task-1"),
    true,
  );
  assert.equal(
    canReuseTaskResultNode({ hasResult: true, taskId: "task-1" }, "task-1"),
    false,
  );
});

test("source output follows newest successful creation time, not completion order", () => {
  const olderTaskThatFinishedLast = {
    ...completedTask("older", 10),
    finishedAt: 100,
  };
  const newerTaskThatFinishedFirst = {
    ...completedTask("newer", 20),
    finishedAt: 50,
  };

  assert.equal(
    selectLatestSuccessfulImageTask(
      [olderTaskThatFinishedLast, newerTaskThatFinishedFirst],
      "source-1",
    )?.id,
    "newer",
  );
});
