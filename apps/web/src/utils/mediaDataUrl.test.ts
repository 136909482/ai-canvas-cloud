import assert from "node:assert/strict";
import test from "node:test";
import { readMediaUrlAsBlob } from "./mediaDataUrl.ts";

test("local image and video data URLs are decoded without fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called for a data URL");
    },
  });

  try {
    const image = await readMediaUrlAsBlob(
      "data:image/png;base64,aW1hZ2U=",
      "image failed",
    );
    const video = await readMediaUrlAsBlob(
      "data:video/mp4;base64,dmlkZW8=",
      "video failed",
    );

    assert.equal(fetchCalls, 0);
    assert.equal(image.type, "image/png");
    assert.equal(await image.text(), "image");
    assert.equal(video.type, "video/mp4");
    assert.equal(await video.text(), "video");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
});

test("remote media URLs retain the existing fetch behavior", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (url: string) => {
      requestedUrls.push(url);
      return new Response("remote", {
        headers: { "Content-Type": "video/webm" },
      });
    },
  });

  try {
    const blob = await readMediaUrlAsBlob(
      "https://assets.example/video.webm",
      "video failed",
    );

    assert.deepEqual(requestedUrls, ["https://assets.example/video.webm"]);
    assert.equal(blob.type, "video/webm");
    assert.equal(await blob.text(), "remote");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
});
