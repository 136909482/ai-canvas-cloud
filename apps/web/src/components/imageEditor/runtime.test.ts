import assert from "node:assert/strict";
import test from "node:test";
import { dataUrlToBlob } from "./runtime.ts";

test("image editor converts canvas data URLs without a fetch request", async () => {
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
    const blob = await dataUrlToBlob(
      "data:image/png;charset=utf-8;base64,aGVsbG8td29ybGQ=",
    );

    assert.equal(fetchCalls, 0);
    assert.equal(blob.type, "image/png");
    assert.equal(await blob.text(), "hello-world");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
});

test("image editor rejects unsupported data URLs", async () => {
  await assert.rejects(
    dataUrlToBlob("data:text/plain;base64,aGVsbG8="),
    /Unsupported Base64 media data URL/,
  );
  await assert.rejects(
    dataUrlToBlob("data:image/png,hello"),
    /Unsupported Base64 media data URL/,
  );
});
