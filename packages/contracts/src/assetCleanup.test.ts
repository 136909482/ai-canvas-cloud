import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAssetCleanupRequest,
  validateAssetCleanupSummary,
} from "./assetCleanup.ts";

test("asset cleanup request accepts only an explicit apply flag", () => {
  assert.deepEqual(validateAssetCleanupRequest({ apply: false }), {
    apply: false,
  });
  assert.deepEqual(validateAssetCleanupRequest({ apply: true }), {
    apply: true,
  });
  assert.throws(() => validateAssetCleanupRequest(null));
  assert.throws(() => validateAssetCleanupRequest({}));
  assert.throws(() => validateAssetCleanupRequest({ apply: "true" }));
  assert.throws(() =>
    validateAssetCleanupRequest({ apply: false, objectKey: "private/key" }),
  );
});

const summary = {
  mode: "preview" as const,
  graceHours: 168,
  cutoff: "2026-07-22T00:00:00.000Z",
  scannedAssetCount: 2,
  reclaimableObjectCount: 1,
  reclaimableBytes: 42,
  deletedObjectCount: 0,
  deletedBytes: 0,
  missingObjectCount: 0,
  finalizedMissingAssetCount: 0,
  retainedAssetCount: 1,
  truncated: false,
  completedAt: "2026-07-29T00:00:00.000Z",
};

test("asset cleanup summary validates and strips no contract fields", () => {
  assert.deepEqual(validateAssetCleanupSummary(summary), summary);
  assert.throws(() =>
    validateAssetCleanupSummary({ ...summary, objectKey: "private/key" }),
  );
  assert.throws(() =>
    validateAssetCleanupSummary({ ...summary, deletedBytes: -1 }),
  );
  assert.throws(() =>
    validateAssetCleanupSummary({ ...summary, completedAt: "not-a-date" }),
  );
});
