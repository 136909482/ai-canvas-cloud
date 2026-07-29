import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeleteOrphanObject,
  classifyAssetGcRetention,
  parseManagedAssetObjectKey,
  validateAssetGcGraceHours,
  validateAssetMaintenanceBatchSize,
} from "../../dist/modules/assets/assetMaintenance.js";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("managed object parsing accepts only canonical Cloud asset keys", () => {
  assert.deepEqual(
    parseManagedAssetObjectKey(
      `workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/uploads/${ASSET_ID}.png`,
    ),
    { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, assetId: ASSET_ID },
  );
  assert.deepEqual(
    parseManagedAssetObjectKey(
      `workspaces/${WORKSPACE_ID}/workspace/generated/2026-07-16/${ASSET_ID}.webp`,
    ),
    { workspaceId: WORKSPACE_ID, projectId: null, assetId: ASSET_ID },
  );
  assert.equal(
    parseManagedAssetObjectKey(`integration-tests/${ASSET_ID}.png`),
    null,
  );
  assert.equal(
    parseManagedAssetObjectKey(
      `workspaces/${WORKSPACE_ID}/arbitrary/${ASSET_ID}.png`,
    ),
    null,
  );
  assert.equal(
    parseManagedAssetObjectKey(
      `workspaces/${WORKSPACE_ID}/workspace/uploads/not-an-id.png`,
    ),
    null,
  );
  assert.equal(
    parseManagedAssetObjectKey(
      `workspaces/${WORKSPACE_ID}/workspace/uploads/${ASSET_ID}.exe`,
    ),
    null,
  );
});

test("GC retention prioritizes live and checkpoint references before grace", () => {
  const cutoff = new Date("2026-07-10T00:00:00.000Z");
  const base = {
    hasCurrentReference: false,
    hasCheckpointReference: false,
    gcEligibleAt: "2026-07-01T00:00:00.000Z",
    cutoff,
  };
  assert.equal(classifyAssetGcRetention(base), "eligible");
  assert.equal(
    classifyAssetGcRetention({
      ...base,
      gcEligibleAt: "2026-07-11T00:00:00.000Z",
    }),
    "grace_period",
  );
  assert.equal(
    classifyAssetGcRetention({ ...base, hasCheckpointReference: true }),
    "checkpoint_reference",
  );
  assert.equal(
    classifyAssetGcRetention({
      ...base,
      hasCurrentReference: true,
      hasCheckpointReference: true,
    }),
    "current_reference",
  );
});

test("orphan deletion requires a canonical key, known timestamp, and elapsed grace", () => {
  const cutoff = new Date("2026-07-10T00:00:00.000Z");
  const objectKey = `workspaces/${WORKSPACE_ID}/workspace/uploads/${ASSET_ID}.png`;
  assert.equal(
    canDeleteOrphanObject({
      objectKey,
      lastModified: "2026-07-01T00:00:00.000Z",
      cutoff,
    }),
    true,
  );
  assert.equal(
    canDeleteOrphanObject({
      objectKey,
      lastModified: "2026-07-11T00:00:00.000Z",
      cutoff,
    }),
    false,
  );
  assert.equal(
    canDeleteOrphanObject({ objectKey, lastModified: null, cutoff }),
    false,
  );
  assert.equal(
    canDeleteOrphanObject({
      objectKey: `other/${ASSET_ID}.png`,
      lastModified: "2026-07-01T00:00:00.000Z",
      cutoff,
    }),
    false,
  );
});

test("asset maintenance bounds batch size and grace duration", () => {
  assert.equal(validateAssetMaintenanceBatchSize(undefined), 100);
  assert.equal(validateAssetGcGraceHours(undefined), 168);
  assert.throws(() => validateAssetMaintenanceBatchSize(0));
  assert.throws(() => validateAssetMaintenanceBatchSize(501));
  assert.throws(() => validateAssetGcGraceHours(0));
  assert.throws(() => validateAssetGcGraceHours(8761));
});
