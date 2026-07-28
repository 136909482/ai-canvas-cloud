import assert from "node:assert/strict";
import test from "node:test";
import { loadImageEditorSource } from "./imageSource";

test("image editor resolves a persistent asset before loading it", async () => {
  const loadedUrls: string[] = [];

  const result = await loadImageEditorSource({
    imageUrl: "https://assets.example/expired",
    relativePath: "cloud-assets/asset-id",
    resolveAssetUrl: async () => "https://assets.example/fresh",
    clearAssetUrlCache: () => assert.fail("cache should not be cleared"),
    load: async (imageUrl) => {
      loadedUrls.push(imageUrl);
      return "image";
    },
  });

  assert.deepEqual(result, {
    imageUrl: "https://assets.example/fresh",
    value: "image",
  });
  assert.deepEqual(loadedUrls, ["https://assets.example/fresh"]);
});

test("image editor clears the asset URL cache and retries once after a load failure", async () => {
  const resolvedUrls = [
    "https://assets.example/stale-cache",
    "https://assets.example/refreshed",
  ];
  const loadedUrls: string[] = [];
  let cacheClearCount = 0;

  const result = await loadImageEditorSource({
    imageUrl: "https://assets.example/expired-node-url",
    relativePath: "cloud-assets/asset-id",
    resolveAssetUrl: async () => resolvedUrls.shift() ?? "",
    clearAssetUrlCache: () => {
      cacheClearCount += 1;
    },
    load: async (imageUrl) => {
      loadedUrls.push(imageUrl);
      if (loadedUrls.length === 1) {
        throw new Error("stale signed URL");
      }
      return "image";
    },
  });

  assert.deepEqual(result, {
    imageUrl: "https://assets.example/refreshed",
    value: "image",
  });
  assert.equal(cacheClearCount, 1);
  assert.deepEqual(loadedUrls, [
    "https://assets.example/stale-cache",
    "https://assets.example/refreshed",
  ]);
});

test("image editor does not retry a non-persistent image URL", async () => {
  let resolveCount = 0;
  let cacheClearCount = 0;
  let loadCount = 0;

  await assert.rejects(
    loadImageEditorSource({
      imageUrl: "data:image/png;base64,broken",
      resolveAssetUrl: async () => {
        resolveCount += 1;
        return "unused";
      },
      clearAssetUrlCache: () => {
        cacheClearCount += 1;
      },
      load: async () => {
        loadCount += 1;
        throw new Error("invalid image");
      },
    }),
    /invalid image/,
  );

  assert.equal(resolveCount, 0);
  assert.equal(cacheClearCount, 0);
  assert.equal(loadCount, 1);
});

test("image editor falls back to the node URL when initial asset resolution fails", async () => {
  const loadedUrls: string[] = [];

  const result = await loadImageEditorSource({
    imageUrl: "https://assets.example/node-url",
    relativePath: "cloud-assets/asset-id",
    resolveAssetUrl: async () => {
      throw new Error("asset API unavailable");
    },
    clearAssetUrlCache: () => assert.fail("cache should not be cleared"),
    load: async (imageUrl) => {
      loadedUrls.push(imageUrl);
      return "image";
    },
  });

  assert.deepEqual(result, {
    imageUrl: "https://assets.example/node-url",
    value: "image",
  });
  assert.deepEqual(loadedUrls, ["https://assets.example/node-url"]);
});
