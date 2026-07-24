import assert from "node:assert/strict";
import test from "node:test";
import {
  collectAssetIdsFromNodeReferenceChanges,
  collectNodeAssetReferenceChanges,
  collectNodeAssetReferenceChangesForNodes,
  extractNodeAssetReferences,
  normalizeAssetManifest,
} from "../../dist/modules/project-graph/assetReferences.js";

const SOURCE_ASSET_ID = "11111111-1111-4111-8111-111111111111";
const RESULT_ASSET_ID = "22222222-2222-4222-8222-222222222222";
const THUMBNAIL_ASSET_ID = "33333333-3333-4333-8333-333333333333";
const PREVIEW_ASSET_ID = "44444444-4444-4444-8444-444444444444";

test("node asset extraction uses persistent Cloud ids and ignores runtime or storage URLs", () => {
  const references = extractNodeAssetReferences({
    nodeType: "imageNode",
    data: {
      imageUrl: "https://storage.example/object.png?X-Amz-Signature=runtime",
      temporaryImage: "blob:http://localhost/runtime",
      maskDataUrl: "data:image/png;base64,temporary",
      objectKey: "workspaces/forged/projects/forged/uploads/object.png",
      imageAsset: {
        assetId: SOURCE_ASSET_ID.toUpperCase(),
        relativePath: `cloud-assets/${SOURCE_ASSET_ID}`,
        assetKind: "upload",
        thumbnailRelativePath: `cloud-assets/${THUMBNAIL_ASSET_ID}`,
        previewRelativePath: `cloud-assets/${PREVIEW_ASSET_ID}`,
      },
      richPrompt: {
        content: [
          { thumbnailRelativePath: `cloud-assets/${THUMBNAIL_ASSET_ID}` },
        ],
      },
    },
  });

  assert.deepEqual(references, [
    { assetId: PREVIEW_ASSET_ID, referenceRole: "preview" },
    { assetId: SOURCE_ASSET_ID, referenceRole: "source" },
    { assetId: THUMBNAIL_ASSET_ID, referenceRole: "thumbnail" },
  ]);
});

test("node asset extraction classifies generated assets as results and rejects inconsistent metadata", () => {
  assert.deepEqual(
    extractNodeAssetReferences({
      nodeType: "generatedPreviewNode",
      data: {
        imageAsset: {
          assetId: RESULT_ASSET_ID,
          relativePath: `cloud-assets/${RESULT_ASSET_ID}`,
          assetKind: "generated",
        },
      },
    }),
    [{ assetId: RESULT_ASSET_ID, referenceRole: "result" }],
  );

  assert.throws(
    () =>
      extractNodeAssetReferences({
        nodeType: "imageNode",
        data: {
          imageAsset: {
            assetId: SOURCE_ASSET_ID,
            relativePath: `cloud-assets/${RESULT_ASSET_ID}`,
          },
        },
      }),
    /different Cloud assets/,
  );
  assert.throws(
    () =>
      extractNodeAssetReferences({
        nodeType: "imageNode",
        data: { imageAsset: { relativePath: "cloud-assets/not-a-uuid" } },
      }),
    /valid Cloud asset locator/,
  );
});

test("graph asset reference changes replace upserts and clear deleted nodes", () => {
  const changes = collectNodeAssetReferenceChanges([
    {
      type: "upsertNode",
      node: {
        id: "node-media",
        nodeType: "imageNode",
        position: { x: 0, y: 0 },
        dataSchemaVersion: 1,
        data: { imageAsset: { assetId: SOURCE_ASSET_ID } },
      },
    },
    { type: "deleteNode", nodeId: "node-deleted" },
    { type: "deleteEdge", edgeId: "edge-ignored" },
  ]);

  assert.deepEqual(changes, [
    {
      nodeId: "node-media",
      references: [{ assetId: SOURCE_ASSET_ID, referenceRole: "source" }],
    },
    { nodeId: "node-deleted", references: [] },
  ]);
});

test("checkpoint asset manifests are sorted, unique, and derived from node records", () => {
  const changes = collectNodeAssetReferenceChangesForNodes([
    {
      id: "node-source",
      nodeType: "imageNode",
      position: { x: 0, y: 0 },
      dataSchemaVersion: 1,
      data: {
        imageAsset: {
          assetId: SOURCE_ASSET_ID,
          thumbnailRelativePath: `cloud-assets/${THUMBNAIL_ASSET_ID}`,
        },
      },
    },
    {
      id: "node-result",
      nodeType: "generatedPreviewNode",
      position: { x: 10, y: 10 },
      dataSchemaVersion: 1,
      data: {
        imageAsset: { relativePath: `cloud-assets/${RESULT_ASSET_ID}` },
        duplicate: { assetId: SOURCE_ASSET_ID },
      },
    },
  ]);

  assert.deepEqual(collectAssetIdsFromNodeReferenceChanges(changes), [
    SOURCE_ASSET_ID,
    RESULT_ASSET_ID,
    THUMBNAIL_ASSET_ID,
  ]);
  assert.deepEqual(
    normalizeAssetManifest([
      THUMBNAIL_ASSET_ID.toUpperCase(),
      SOURCE_ASSET_ID,
      SOURCE_ASSET_ID,
    ]),
    [SOURCE_ASSET_ID, THUMBNAIL_ASSET_ID],
  );
  assert.throws(() => normalizeAssetManifest({}), /must be an array/);
  assert.throws(
    () => normalizeAssetManifest(["not-a-uuid"]),
    /valid asset UUID/,
  );
});
