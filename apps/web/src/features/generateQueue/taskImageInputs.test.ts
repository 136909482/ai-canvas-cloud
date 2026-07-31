import assert from "node:assert/strict";
import test from "node:test";
import type { GenerateTask, GenerateTaskImageSource } from "@/types";
import {
  resolveTaskImageInputs,
  runWithTaskImageInputRefresh,
} from "./taskImageInputs.ts";

function imageSource(
  imageUrl: string,
  assetRelativePath: string | null,
  sourceNodeId: string,
): GenerateTaskImageSource {
  return { imageUrl, assetRelativePath, sourceNodeId };
}

function task(referenceImages: GenerateTaskImageSource[]): GenerateTask {
  return {
    id: "task-1",
    displayId: "task-1",
    projectId: "project-1",
    kind: "image",
    sourceNodeId: "generate-1",
    previewNodeId: "preview-1",
    model: "model-1",
    prompt: "prompt",
    negativePrompt: "",
    ratio: "1:1",
    resolution: "1K",
    operationType: referenceImages.length ? "image-to-image" : "text-to-image",
    sourceImageNodeId: null,
    maskImageUrl: null,
    apiProfileId: null,
    apiProfileName: null,
    provider: "openai",
    referenceImages,
    status: "running",
    errorMsg: "",
    remoteTaskId: null,
    remoteStatus: null,
    createdAt: 1,
    startedAt: 1,
    finishedAt: null,
  };
}

test("task image inputs resolve persistent assets in reference order", async () => {
  const input = task([
    imageSource("https://stale/one", "cloud-assets/asset-1", "image-1"),
    imageSource("https://stale/two", "cloud-assets/asset-2", "image-2"),
  ]);
  const resolvedPaths: string[] = [];

  const result = await resolveTaskImageInputs(input, async (relativePath) => {
    resolvedPaths.push(relativePath);
    return `https://fresh/${relativePath.at(-1)}`;
  });

  assert.deepEqual(resolvedPaths, [
    "cloud-assets/asset-1",
    "cloud-assets/asset-2",
  ]);
  assert.deepEqual(result.referenceImageUrls, [
    "https://fresh/1",
    "https://fresh/2",
  ]);
});

test("an asset-only task restored on another device resolves a fresh URL", async () => {
  const input = task([imageSource("", "cloud-assets/asset-1", "image-1")]);

  const result = await resolveTaskImageInputs(
    input,
    async () => "https://device-two/fresh-reference",
  );

  assert.deepEqual(result.referenceImageUrls, [
    "https://device-two/fresh-reference",
  ]);
});

test("reference image HTTP 403 clears the cache and retries exactly once", async () => {
  const input = task([
    imageSource("https://stale/one", "cloud-assets/asset-1", "image-1"),
  ]);
  let cacheClears = 0;
  let executions = 0;

  const result = await runWithTaskImageInputRefresh(
    input,
    {
      resolveAssetUrl: async () =>
        cacheClears === 0 ? "https://cached/one" : "https://fresh/one",
      clearAssetUrlCache: () => {
        cacheClears += 1;
      },
    },
    async ({ referenceImageUrls }) => {
      executions += 1;
      if (executions === 1) {
        throw new Error("Reference image 1 fetch failed: HTTP 403");
      }
      return referenceImageUrls[0];
    },
  );

  assert.equal(result, "https://fresh/one");
  assert.equal(cacheClears, 1);
  assert.equal(executions, 2);
});

test("provider failures are not retried", async () => {
  const input = task([
    imageSource("https://stale/one", "cloud-assets/asset-1", "image-1"),
  ]);
  let cacheClears = 0;
  let executions = 0;

  await assert.rejects(
    runWithTaskImageInputRefresh(
      input,
      {
        resolveAssetUrl: async () => "https://fresh/one",
        clearAssetUrlCache: () => {
          cacheClears += 1;
        },
      },
      async () => {
        executions += 1;
        throw new Error(
          "Image API failed: image generation service unavailable",
        );
      },
    ),
    /image generation service unavailable/,
  );

  assert.equal(cacheClears, 0);
  assert.equal(executions, 1);
});

test("a failed forced refresh reports a clear Chinese error", async () => {
  const input = task([
    imageSource("https://stale/one", "cloud-assets/asset-1", "image-1"),
  ]);
  let cacheClears = 0;
  let executions = 0;

  await assert.rejects(
    runWithTaskImageInputRefresh(
      input,
      {
        resolveAssetUrl: async () => {
          if (cacheClears === 0) return "https://cached/one";
          throw new Error("asset service unavailable");
        },
        clearAssetUrlCache: () => {
          cacheClears += 1;
        },
      },
      async () => {
        executions += 1;
        throw new Error("Reference image 1 fetch failed: HTTP 403");
      },
    ),
    /第 1 张参考图访问凭证刷新失败/,
  );

  assert.equal(cacheClears, 1);
  assert.equal(executions, 1);
});
