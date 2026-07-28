import assert from "node:assert/strict";
import test from "node:test";
import { getPreviewNodeSizeAtWidth } from "./previewUtils";

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
