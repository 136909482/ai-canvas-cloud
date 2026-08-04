import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReferenceImageAsset,
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

test("reference image keys reject incomplete fields", () => {
  assert.equal(
    decodeReferenceImageKey(
      ["image-1", "data:image/png;base64,abc", "cloud-assets/thumb-1"].join(
        "\u0000",
      ),
    ),
    null,
  );
});

test("reference image previews retain stable original and thumbnail asset paths", () => {
  assert.deepEqual(
    buildReferenceImageAsset({
      sourceId: "image-1",
      imageUrl: "https://signed/original",
      thumbnailRelativePath: "cloud-assets/thumb-1",
      assetRelativePath: "cloud-assets/original-1",
    }),
    {
      relativePath: "cloud-assets/original-1",
      mimeType: "",
      fileName: "",
      thumbnailRelativePath: "cloud-assets/thumb-1",
    },
  );
});
