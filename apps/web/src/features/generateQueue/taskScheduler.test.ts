import assert from "node:assert/strict";
import test from "node:test";
import type { GenerateTask } from "@/types";
import { selectLaunchableTaskIds } from "./taskScheduler.ts";

function task(
  id: string,
  kind: GenerateTask["kind"],
  status: GenerateTask["status"],
  createdAt: number,
): GenerateTask {
  return {
    id,
    displayId: id,
    projectId: "project-1",
    kind,
    sourceNodeId: `source-${id}`,
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
    status,
    errorMsg: "",
    remoteTaskId: null,
    remoteStatus: null,
    createdAt,
    startedAt: status === "running" ? createdAt : 0,
    finishedAt: null,
  };
}

test("scheduler launches eight FIFO image tasks and one independent video", () => {
  const tasks = [
    ...Array.from({ length: 9 }, (_, index) =>
      task(`image-${index + 1}`, "image", "queued", index + 1),
    ),
    task("video-1", "video", "queued", 10),
  ];

  assert.deepEqual(selectLaunchableTaskIds(tasks), [
    "image-1",
    "image-2",
    "image-3",
    "image-4",
    "image-5",
    "image-6",
    "image-7",
    "image-8",
    "video-1",
  ]);
});

test("scheduler fills a freed image slot without consuming the video lane", () => {
  const tasks = [
    ...Array.from({ length: 7 }, (_, index) =>
      task(`running-image-${index + 1}`, "image", "running", index + 1),
    ),
    task("next-image", "image", "queued", 20),
    task("waiting-image", "image", "queued", 21),
    task("running-video", "video", "running", 22),
    task("waiting-video", "video", "queued", 23),
  ];

  assert.deepEqual(selectLaunchableTaskIds(tasks), ["next-image"]);
});
