import assert from "node:assert/strict";
import test from "node:test";
import { downloadPreviewImage } from "./downloadImage";

test("preview download resolves the persistent original asset before downloading", async () => {
  const downloadedUrls: string[] = [];

  const result = await downloadPreviewImage({
    imageUrl: "https://assets.example/expired-thumbnail",
    relativePath: "cloud-assets/original-id",
    resolveAssetUrl: async () => "https://assets.example/fresh-original",
    clearAssetUrlCache: () => assert.fail("cache should not be cleared"),
    download: async (imageUrl) => {
      downloadedUrls.push(imageUrl);
      return "original-image";
    },
  });

  assert.equal(result, "original-image");
  assert.deepEqual(downloadedUrls, ["https://assets.example/fresh-original"]);
});

test("preview download clears the signed URL cache and retries once", async () => {
  const resolvedUrls = [
    "https://assets.example/stale-original",
    "https://assets.example/refreshed-original",
  ];
  const downloadedUrls: string[] = [];
  let cacheClearCount = 0;

  const result = await downloadPreviewImage({
    imageUrl: "https://assets.example/expired-thumbnail",
    relativePath: "cloud-assets/original-id",
    resolveAssetUrl: async () => resolvedUrls.shift() ?? "",
    clearAssetUrlCache: () => {
      cacheClearCount += 1;
    },
    download: async (imageUrl) => {
      downloadedUrls.push(imageUrl);
      if (downloadedUrls.length === 1) {
        throw new Error("HTTP 403");
      }
      return "original-image";
    },
  });

  assert.equal(result, "original-image");
  assert.equal(cacheClearCount, 1);
  assert.deepEqual(downloadedUrls, [
    "https://assets.example/stale-original",
    "https://assets.example/refreshed-original",
  ]);
});

test("preview download keeps non-persistent images on their direct URL", async () => {
  let resolveCount = 0;
  let cacheClearCount = 0;

  const result = await downloadPreviewImage({
    imageUrl: "data:image/png;base64,image",
    resolveAssetUrl: async () => {
      resolveCount += 1;
      return "unused";
    },
    clearAssetUrlCache: () => {
      cacheClearCount += 1;
    },
    download: async (imageUrl) => imageUrl,
  });

  assert.equal(result, "data:image/png;base64,image");
  assert.equal(resolveCount, 0);
  assert.equal(cacheClearCount, 0);
});
