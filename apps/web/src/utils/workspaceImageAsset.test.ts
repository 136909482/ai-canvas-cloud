import assert from "node:assert/strict";
import test from "node:test";
import {
  getWorkspaceAssetRelativePath,
  getWorkspaceAssetThumbnailRelativePath,
} from "./workspaceImageAsset.ts";

test("generation and previews select separate persistent asset paths", () => {
  const asset = {
    relativePath: "cloud-assets/11111111-1111-4111-8111-111111111111",
    thumbnailRelativePath: "cloud-assets/22222222-2222-4222-8222-222222222222",
  };

  assert.equal(
    getWorkspaceAssetRelativePath(asset),
    asset.relativePath,
    "generation should use the original asset",
  );
  assert.equal(
    getWorkspaceAssetThumbnailRelativePath(asset),
    asset.thumbnailRelativePath,
    "canvas previews should keep using the thumbnail asset",
  );
});
