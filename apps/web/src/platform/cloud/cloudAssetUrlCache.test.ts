import assert from "node:assert/strict";
import test from "node:test";
import type { AssetUrlResponse } from "@ai-canvas-cloud/contracts";
import {
  createCloudAssetRelativePath,
  createCloudAssetUrlCache,
  getCloudAssetIdFromRelativePath,
} from "./cloudAssetUrlCache.ts";

const ASSET_ID = "66666666-6666-4666-8666-666666666666";

function assetUrlResponse(url: string, expiresAtMs: number): AssetUrlResponse {
  return {
    assetId: ASSET_ID,
    url,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

test("cloud asset relative paths are explicit client locators rather than object keys", () => {
  const relativePath = createCloudAssetRelativePath(ASSET_ID.toUpperCase());

  assert.equal(relativePath, `cloud-assets/${ASSET_ID}`);
  assert.equal(getCloudAssetIdFromRelativePath(relativePath), ASSET_ID);
  assert.equal(getCloudAssetIdFromRelativePath(`/${relativePath}`), ASSET_ID);
  assert.equal(
    getCloudAssetIdFromRelativePath("projects/project-1/image.png"),
    null,
  );
  assert.equal(getCloudAssetIdFromRelativePath("cloud-assets/not-an-id"), null);
});

test("cloud asset URL cache reuses valid signed URLs and refreshes inside the expiry window", async () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const loads: string[] = [];
  const cache = createCloudAssetUrlCache({
    now: () => now,
    refreshSkewMs: 30_000,
    async loadAssetUrl(assetId) {
      loads.push(assetId);
      return assetUrlResponse(
        `https://storage.example/read-${loads.length}`,
        now + 5 * 60_000,
      );
    },
  });

  assert.equal(await cache.resolve(ASSET_ID), "https://storage.example/read-1");
  now += 4 * 60_000;
  assert.equal(await cache.resolve(ASSET_ID), "https://storage.example/read-1");
  now += 31_000;
  assert.equal(await cache.resolve(ASSET_ID), "https://storage.example/read-2");
  assert.deepEqual(loads, [ASSET_ID, ASSET_ID]);
});

test("cloud asset URL cache merges concurrent refreshes for the same asset", async () => {
  const now = Date.parse("2026-07-16T00:00:00.000Z");
  const resolvers: Array<(response: AssetUrlResponse) => void> = [];
  let loadCount = 0;
  const cache = createCloudAssetUrlCache({
    now: () => now,
    loadAssetUrl() {
      loadCount += 1;
      return new Promise<AssetUrlResponse>((resolve) => {
        resolvers.push(resolve);
      });
    },
  });

  const first = cache.resolve(ASSET_ID);
  const second = cache.resolve(ASSET_ID);
  assert.equal(loadCount, 1);

  resolvers[0](
    assetUrlResponse("https://storage.example/shared", now + 300_000),
  );
  assert.deepEqual(await Promise.all([first, second]), [
    "https://storage.example/shared",
    "https://storage.example/shared",
  ]);
});

test("clearing the cache rejects stale in-flight results and forces a new session-scoped request", async () => {
  const now = Date.parse("2026-07-16T00:00:00.000Z");
  const resolvers: Array<(response: AssetUrlResponse) => void> = [];
  const cache = createCloudAssetUrlCache({
    now: () => now,
    loadAssetUrl() {
      return new Promise<AssetUrlResponse>((resolve) => {
        resolvers.push(resolve);
      });
    },
  });

  const oldSessionRequest = cache.resolve(ASSET_ID);
  cache.clear();
  resolvers[0](
    assetUrlResponse("https://storage.example/old-session", now + 300_000),
  );
  await assert.rejects(oldSessionRequest, /cache was cleared/);

  const newSessionRequest = cache.resolve(ASSET_ID);
  assert.equal(resolvers.length, 2);
  resolvers[1](
    assetUrlResponse("https://storage.example/new-session", now + 300_000),
  );
  assert.equal(await newSessionRequest, "https://storage.example/new-session");
  assert.equal(
    await cache.resolve(ASSET_ID),
    "https://storage.example/new-session",
  );
});

test("invalidating one asset refreshes only that signed URL", async () => {
  const now = Date.parse("2026-07-16T00:00:00.000Z");
  const secondAssetId = "77777777-7777-4777-8777-777777777777";
  const loads: string[] = [];
  const cache = createCloudAssetUrlCache({
    now: () => now,
    async loadAssetUrl(assetId) {
      loads.push(assetId);
      return {
        assetId,
        url: `https://storage.example/${assetId}/${loads.length}`,
        expiresAt: new Date(now + 300_000).toISOString(),
      };
    },
  });

  await cache.resolve(ASSET_ID);
  await cache.resolve(secondAssetId);
  cache.invalidate(ASSET_ID);

  assert.equal(
    await cache.resolve(ASSET_ID),
    `https://storage.example/${ASSET_ID}/3`,
  );
  assert.equal(
    await cache.resolve(secondAssetId),
    `https://storage.example/${secondAssetId}/2`,
  );
  assert.deepEqual(loads, [ASSET_ID, secondAssetId, ASSET_ID]);
});

test("cloud asset URL cache rejects mismatched or expired responses", async () => {
  const now = Date.parse("2026-07-16T00:00:00.000Z");
  const mismatched = createCloudAssetUrlCache({
    now: () => now,
    async loadAssetUrl() {
      return {
        assetId: "77777777-7777-4777-8777-777777777777",
        url: "https://storage.example/mismatched",
        expiresAt: new Date(now + 300_000).toISOString(),
      };
    },
  });
  await assert.rejects(mismatched.resolve(ASSET_ID), /does not match/);

  const expired = createCloudAssetUrlCache({
    now: () => now,
    async loadAssetUrl() {
      return assetUrlResponse("https://storage.example/expired", now);
    },
  });
  await assert.rejects(expired.resolve(ASSET_ID), /already expired or invalid/);
});
