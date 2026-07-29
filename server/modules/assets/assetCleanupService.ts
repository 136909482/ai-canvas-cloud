import {
  type AssetCleanupRequest,
  type AssetCleanupSummary,
} from "@ai-canvas-cloud/contracts";
import {
  ASSET_GC_DEFAULT_GRACE_HOURS,
  ASSET_MAINTENANCE_DEFAULT_BATCH_SIZE,
  validateAssetGcGraceHours,
} from "./assetMaintenance.js";
import type {
  AssetMaintenanceCursor,
  PostgresAssetMaintenanceService,
} from "./postgresAssetMaintenance.js";

export interface AssetCleanupService {
  run(input: AssetCleanupRequest): Promise<AssetCleanupSummary>;
}

export function createAssetCleanupService(
  maintenance: Pick<
    PostgresAssetMaintenanceService,
    "cleanupUnreferencedAssetBatch"
  >,
  options: {
    now?: () => Date;
    graceHours?: number;
    batchSize?: number;
    maxBatches?: number;
  } = {},
): AssetCleanupService {
  const graceHours = validateAssetGcGraceHours(
    options.graceHours ?? ASSET_GC_DEFAULT_GRACE_HOURS,
  );
  const batchSize = options.batchSize ?? ASSET_MAINTENANCE_DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? 50;
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 1_000) {
    throw new Error("maxBatches must be between 1 and 1000");
  }

  return {
    async run(input) {
      const now = (options.now ?? (() => new Date()))();
      const cutoff = new Date(now.getTime() - graceHours * 60 * 60 * 1_000);
      let cursor: AssetMaintenanceCursor | null = null;
      let batches = 0;
      let scannedAssetCount = 0;
      let reclaimableObjectCount = 0;
      let reclaimableBytes = 0;
      let deletedObjectCount = 0;
      let deletedBytes = 0;
      let missingObjectCount = 0;
      let finalizedMissingAssetCount = 0;
      let retainedAssetCount = 0;

      do {
        const batch = await maintenance.cleanupUnreferencedAssetBatch({
          apply: input.apply,
          batchSize,
          cutoff,
          cursor,
        });
        batches += 1;
        for (const item of batch.items) {
          scannedAssetCount += 1;
          if (
            item.action === "would_delete_asset_object" ||
            item.action === "asset_object_deleted"
          ) {
            reclaimableObjectCount += 1;
            reclaimableBytes += item.byteSize;
          }
          if (item.action === "asset_object_deleted") {
            deletedObjectCount += 1;
            deletedBytes += item.byteSize;
          } else if (item.action === "would_finalize_missing_object") {
            missingObjectCount += 1;
          } else if (item.action === "missing_object_finalized") {
            missingObjectCount += 1;
            finalizedMissingAssetCount += 1;
          } else if (
            item.action === "retained" ||
            item.action === "missing_object" ||
            item.action === "already_deleted" ||
            item.action === "skipped_locked"
          ) {
            retainedAssetCount += 1;
          }
        }
        cursor = batch.nextCursor;
      } while (cursor && batches < maxBatches);

      return {
        mode: input.apply ? "apply" : "preview",
        graceHours,
        cutoff: cutoff.toISOString(),
        scannedAssetCount,
        reclaimableObjectCount,
        reclaimableBytes,
        deletedObjectCount,
        deletedBytes,
        missingObjectCount,
        finalizedMissingAssetCount,
        retainedAssetCount,
        truncated: cursor !== null,
        completedAt: now.toISOString(),
      };
    },
  };
}
