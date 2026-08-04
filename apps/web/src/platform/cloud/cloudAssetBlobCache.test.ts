import assert from "node:assert/strict";
import test from "node:test";
import { createCloudAssetBlobCache } from "./cloudAssetBlobCache.ts";

function imageResponse(value: string, status = 200) {
  return new Response(new Blob([value], { type: "image/png" }), { status });
}

test("cloud asset Blob cache merges concurrent loads and reuses the result", async () => {
  const fetchResolvers: Array<(response: Response) => void> = [];
  let fetchCount = 0;
  const cache = createCloudAssetBlobCache({
    resolveAssetUrl: async (assetId) => `https://storage.example/${assetId}`,
    refreshAssetUrl: async (assetId) =>
      `https://storage.example/${assetId}?fresh=1`,
    fetchAsset: async () => {
      fetchCount += 1;
      return new Promise<Response>((resolve) => {
        fetchResolvers.push(resolve);
      });
    },
  });

  const first = cache.load("asset-a");
  const second = cache.load("asset-a");
  await Promise.resolve();
  assert.equal(fetchCount, 1);
  assert.equal(fetchResolvers.length, 1);
  fetchResolvers[0]?.(imageResponse("shared-image"));

  const [firstBlob, secondBlob] = await Promise.all([first, second]);
  assert.equal(firstBlob, secondBlob);
  assert.equal(await firstBlob.text(), "shared-image");
  assert.equal(await cache.load("asset-a"), firstBlob);
  assert.equal(fetchCount, 1);
});

test("cloud asset Blob cache refreshes only after a failed signed URL", async () => {
  const requestedUrls: string[] = [];
  const cache = createCloudAssetBlobCache({
    resolveAssetUrl: async () => "https://storage.example/stale",
    refreshAssetUrl: async () => "https://storage.example/fresh",
    fetchAsset: async (url) => {
      requestedUrls.push(url);
      return url.endsWith("/stale")
        ? imageResponse("expired", 403)
        : imageResponse("fresh-image");
    },
  });

  const blob = await cache.load("asset-a");

  assert.equal(await blob.text(), "fresh-image");
  assert.deepEqual(requestedUrls, [
    "https://storage.example/stale",
    "https://storage.example/fresh",
  ]);
});

test("cloud asset Blob cache evicts least recently used entries within limits", async () => {
  const fetchedAssets: string[] = [];
  const cache = createCloudAssetBlobCache({
    maxEntries: 2,
    maxBytes: 64,
    resolveAssetUrl: async (assetId) => `https://storage.example/${assetId}`,
    refreshAssetUrl: async (assetId) =>
      `https://storage.example/${assetId}?fresh=1`,
    fetchAsset: async (url) => {
      const assetId = new URL(url).pathname.slice(1);
      fetchedAssets.push(assetId);
      return imageResponse(assetId);
    },
  });

  await cache.load("asset-a");
  await cache.load("asset-b");
  await cache.load("asset-a");
  await cache.load("asset-c");
  await cache.load("asset-b");

  assert.deepEqual(fetchedAssets, ["asset-a", "asset-b", "asset-c", "asset-b"]);
});

test("clearing the Blob cache prevents an old session load from being retained", async () => {
  const fetchResolvers: Array<(response: Response) => void> = [];
  const cache = createCloudAssetBlobCache({
    resolveAssetUrl: async () => "https://storage.example/asset-a",
    refreshAssetUrl: async () => "https://storage.example/asset-a?fresh=1",
    fetchAsset: async () =>
      new Promise<Response>((resolve) => {
        fetchResolvers.push(resolve);
      }),
  });

  const oldSessionLoad = cache.load("asset-a");
  await Promise.resolve();
  cache.clear();
  assert.equal(fetchResolvers.length, 1);
  fetchResolvers[0]?.(imageResponse("old-session"));

  await assert.rejects(
    oldSessionLoad,
    /cleared while the request was in flight/,
  );
});
