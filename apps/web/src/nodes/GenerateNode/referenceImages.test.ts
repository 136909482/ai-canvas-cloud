import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeReferenceImageKey,
  encodeReferenceImageKey,
} from "./referenceImages.ts";

test("reference image keys preserve original and thumbnail asset paths", () => {
  const value = {
    sourceId: "image-1",
    imageUrl: "https://signed/original",
    thumbnailRelativePath: "cloud-assets/thumb-1",
    assetRelativePath: "cloud-assets/original-1",
  };

  assert.deepEqual(
    decodeReferenceImageKey(encodeReferenceImageKey(value)),
    value,
  );
});

test("reference image keys remain compatible with the legacy three fields", () => {
  assert.deepEqual(
    decodeReferenceImageKey(
      ["image-1", "data:image/png;base64,abc", "cloud-assets/thumb-1"].join(
        "\u0000",
      ),
    ),
    {
      sourceId: "image-1",
      imageUrl: "data:image/png;base64,abc",
      thumbnailRelativePath: "cloud-assets/thumb-1",
      assetRelativePath: undefined,
    },
  );
});
