import assert from "node:assert/strict";
import test from "node:test";
import {
  canCancelQueuedTask,
  filterTaskQueueTasks,
  getTaskProgressLabel,
  getTaskQueuePosition,
  hasInterruptibleSynchronousImageTask,
} from "./taskQueueView.ts";
import type { GenerateTask } from "@/types";

function task(id: string, status: GenerateTask["status"]): GenerateTask {
  return {
    id,
    displayId: id,
    projectId: "project-1",
    kind: "image",
    sourceNodeId: "source-1",
    previewNodeId: "preview-1",
    model: "gpt-image-2",
    prompt: "",
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
    status,
    errorMsg: "",
    remoteTaskId: null,
    remoteStatus: null,
    createdAt: 1,
    startedAt: 0,
    finishedAt: null,
  };
}

test("task queue filters preserve active and finished task boundaries", () => {
  const tasks = [
    task("queued", "queued"),
    task("running", "running"),
    task("done", "done"),
    task("error", "error"),
  ];

  assert.deepEqual(
    filterTaskQueueTasks(tasks, "all").map((item) => item.id),
    ["queued", "running", "done", "error"],
  );
  assert.deepEqual(
    filterTaskQueueTasks(tasks, "active").map((item) => item.id),
    ["queued", "running"],
  );
  assert.deepEqual(
    filterTaskQueueTasks(tasks, "finished").map((item) => item.id),
    ["done", "error"],
  );
});

test("queue positions are FIFO within each task lane", () => {
  const firstImage = { ...task("image-1", "queued"), createdAt: 10 };
  const video = {
    ...task("video-1", "queued"),
    kind: "video" as const,
    createdAt: 11,
  };
  const secondImage = { ...task("image-2", "queued"), createdAt: 12 };

  assert.equal(
    getTaskQueuePosition([secondImage, video, firstImage], "image-1"),
    1,
  );
  assert.equal(
    getTaskQueuePosition([secondImage, video, firstImage], "image-2"),
    2,
  );
  assert.equal(
    getTaskQueuePosition([secondImage, video, firstImage], "video-1"),
    1,
  );
});

test("task progress labels expose requesting, polling, and persisting phases", () => {
  assert.equal(
    getTaskProgressLabel({
      ...task("requesting", "running"),
      phase: "requesting",
    }),
    "请求中",
  );
  assert.equal(
    getTaskProgressLabel({
      ...task("polling", "running"),
      phase: "polling",
    }),
    "服务商生成中",
  );
  assert.equal(
    getTaskProgressLabel({
      ...task("persisting", "running"),
      phase: "persisting",
    }),
    "保存中",
  );
});

test("only an in-flight synchronous image request needs an interruption warning", () => {
  const synchronous = {
    ...task("sync", "running"),
    phase: "requesting" as const,
    executionMode: "sync" as const,
  };
  const polling = {
    ...task("polling", "running"),
    phase: "polling" as const,
    executionMode: "polling" as const,
    remoteTaskId: "remote-1",
  };
  const persisting = {
    ...task("persisting", "running"),
    phase: "persisting" as const,
    executionMode: "sync" as const,
  };

  assert.equal(hasInterruptibleSynchronousImageTask([synchronous]), true);
  assert.equal(
    hasInterruptibleSynchronousImageTask([polling, persisting]),
    false,
  );
});

test("queue cancellation cannot discard remote or pending-save results", () => {
  assert.equal(canCancelQueuedTask(task("new", "queued")), true);
  assert.equal(
    canCancelQueuedTask({
      ...task("remote", "queued"),
      phase: "polling",
      remoteTaskId: "remote-1",
    }),
    false,
  );
  assert.equal(
    canCancelQueuedTask({
      ...task("persisting", "queued"),
      phase: "persisting",
    }),
    false,
  );
});
