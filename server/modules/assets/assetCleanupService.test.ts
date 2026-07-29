import assert from "node:assert/strict";
import test from "node:test";
import { createAssetCleanupService } from "../../dist/modules/assets/assetCleanupService.js";
import type { AssetMaintenanceBatch } from "../../dist/modules/assets/postgresAssetMaintenance.js";

const firstBatch: AssetMaintenanceBatch = {
  items: [
    {
      assetId: "asset-1",
      objectKey: "private/asset-1.png",
      byteSize: 12,
      action: "would_delete_asset_object",
      reason: "eligible",
      statusBefore: "completed",
      statusAfter: "deleted",
    },
    {
      assetId: "asset-2",
      objectKey: "private/asset-2.png",
      byteSize: 20,
      action: "would_finalize_missing_object",
      reason: "object_missing",
      statusBefore: "completed",
      statusAfter: "deleted",
    },
  ],
  nextCursor: { createdAt: "2026-07-01T00:00:00.000Z", id: "asset-2" },
};

test("asset cleanup preview aggregates pages without exposing asset details", async () => {
  const cursors: unknown[] = [];
  const service = createAssetCleanupService(
    {
      async cleanupUnreferencedAssetBatch(input) {
        cursors.push(input.cursor);
        return cursors.length === 1
          ? firstBatch
          : {
              items: [
                {
                  assetId: "asset-3",
                  objectKey: "private/asset-3.png",
                  byteSize: 30,
                  action: "retained",
                  reason: "grace_period",
                  statusBefore: "completed",
                  statusAfter: "completed",
                },
              ],
              nextCursor: null,
            };
      },
    },
    { now: () => new Date("2026-07-29T00:00:00.000Z"), batchSize: 2 },
  );

  const summary = await service.run({ apply: false });
  assert.deepEqual(cursors, [null, firstBatch.nextCursor]);
  assert.equal(summary.mode, "preview");
  assert.equal(summary.cutoff, "2026-07-22T00:00:00.000Z");
  assert.equal(summary.scannedAssetCount, 3);
  assert.equal(summary.reclaimableObjectCount, 1);
  assert.equal(summary.reclaimableBytes, 12);
  assert.equal(summary.missingObjectCount, 1);
  assert.equal(summary.retainedAssetCount, 1);
  assert.equal(JSON.stringify(summary).includes("private/"), false);
});

test("asset cleanup apply reports deleted and finalized missing records", async () => {
  const service = createAssetCleanupService(
    {
      async cleanupUnreferencedAssetBatch(input) {
        assert.equal(input.apply, true);
        return {
          items: [
            {
              ...firstBatch.items[0]!,
              action: "asset_object_deleted",
            },
            {
              ...firstBatch.items[1]!,
              action: "missing_object_finalized",
            },
          ],
          nextCursor: null,
        };
      },
    },
    { now: () => new Date("2026-07-29T00:00:00.000Z") },
  );

  const summary = await service.run({ apply: true });
  assert.equal(summary.mode, "apply");
  assert.equal(summary.deletedObjectCount, 1);
  assert.equal(summary.deletedBytes, 12);
  assert.equal(summary.finalizedMissingAssetCount, 1);
  assert.equal(summary.missingObjectCount, 1);
});

test("asset cleanup reports truncation when the batch ceiling is reached", async () => {
  const service = createAssetCleanupService(
    {
      async cleanupUnreferencedAssetBatch() {
        return { items: [], nextCursor: firstBatch.nextCursor };
      },
    },
    { maxBatches: 2 },
  );
  assert.equal((await service.run({ apply: false })).truncated, true);
});
