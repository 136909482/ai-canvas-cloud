import assert from "node:assert/strict";
import test from "node:test";
import {
  getPreviewNodeSizeAtWidth,
  resolveImageDimensions,
} from "./previewUtils";

test("official image dimensions use the asset metadata when available", async () => {
  let readCount = 0;
  const dimensions = await resolveImageDimensions(
    { width: 1024, height: 1024 },
    "blob:official",
    async () => {
      readCount += 1;
      return { width: 2048, height: 2048 };
    },
  );

  assert.deepEqual(dimensions, { width: 1024, height: 1024 });
  assert.equal(readCount, 0);
});

test("official image dimensions fall back to the resolved image", async () => {
  const dimensions = await resolveImageDimensions(
    { width: null, height: null },
    "blob:official",
    async () => ({ width: 1536, height: 1024 }),
  );

  assert.deepEqual(dimensions, { width: 1536, height: 1024 });
});

test("image editor preview height follows a wide image at the fixed node width", () => {
  assert.deepEqual(getPreviewNodeSizeAtWidth(2816, 1536, 300), {
    width: 300,
    height: 200,
  });
});

test("image editor preview height follows portrait images without changing width", () => {
  assert.deepEqual(getPreviewNodeSizeAtWidth(768, 1024, 300), {
    width: 300,
    height: 396,
  });
});

test("image editor preview sizing handles invalid dimensions safely", () => {
  assert.deepEqual(getPreviewNodeSizeAtWidth(0, 0, 300), {
    width: 300,
    height: 200,
  });
});
