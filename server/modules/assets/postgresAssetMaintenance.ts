import {
  withTransaction,
  type DbClient,
  type DbPool,
} from "../../db/postgres.js";
import {
  canDeleteOrphanObject,
  classifyAssetGcRetention,
  MANAGED_ASSET_OBJECT_PREFIX,
  parseManagedAssetObjectKey,
  validateAssetMaintenanceBatchSize,
  type AssetGcRetentionReason,
  type AssetGcStatus,
  type AssetMaintenanceObjectStorage,
} from "./assetMaintenance.js";

interface AssetMaintenanceRow {
  id: string;
  workspace_id: string;
  object_key: string;
  byte_size: number | string;
  status: AssetGcStatus;
  has_current_reference: boolean;
  has_checkpoint_reference: boolean;
  has_community_reference: boolean;
  gc_eligible_at: string;
  created_at_cursor: string;
}

export interface AssetMaintenanceCursor {
  createdAt: string;
  id: string;
}

export type AssetMaintenanceAction =
  | "retained"
  | "missing_object"
  | "would_delete_asset_object"
  | "asset_object_deleted"
  | "would_finalize_missing_object"
  | "missing_object_finalized"
  | "already_deleted"
  | "skipped_locked";

export type AssetMaintenanceReason =
  AssetGcRetentionReason | "object_missing" | "row_locked";

export interface AssetMaintenanceItem {
  assetId: string;
  objectKey: string;
  byteSize: number;
  action: AssetMaintenanceAction;
  reason: AssetMaintenanceReason;
  statusBefore: AssetGcStatus;
  statusAfter: AssetGcStatus;
}

export interface AssetMaintenanceBatch {
  items: AssetMaintenanceItem[];
  nextCursor: AssetMaintenanceCursor | null;
}

export type OrphanObjectMaintenanceAction =
  | "retained"
  | "ignored_unmanaged"
  | "would_delete_orphan_object"
  | "orphan_object_deleted";

export interface OrphanObjectMaintenanceItem {
  objectKey: string;
  action: OrphanObjectMaintenanceAction;
  reason:
    "database_record_exists" | "grace_period" | "unrecognized_key" | "orphaned";
}

export interface OrphanObjectMaintenancePage {
  items: OrphanObjectMaintenanceItem[];
  nextStartAfter: string | null;
}

export interface AssetMaintenanceInput {
  apply?: boolean;
  batchSize?: number;
  cutoff: Date;
  cursor?: AssetMaintenanceCursor | null;
}

export interface OrphanObjectMaintenanceInput {
  apply?: boolean;
  batchSize?: number;
  cutoff: Date;
  startAfter?: string | null;
}

export interface PostgresAssetMaintenanceService {
  maintainAssetBatch: (
    input: AssetMaintenanceInput,
  ) => Promise<AssetMaintenanceBatch>;
  maintainOrphanObjectPage: (
    input: OrphanObjectMaintenanceInput,
  ) => Promise<OrphanObjectMaintenancePage>;
  cleanupUnreferencedAssetBatch: (
    input: AssetMaintenanceInput,
  ) => Promise<AssetMaintenanceBatch>;
}

function assetSelect(lockClause = "") {
  return `
    SELECT
      a.id::text,
      a.workspace_id::text,
      a.object_key,
      a.byte_size,
      a.status,
      EXISTS (
        SELECT 1
        FROM asset_references ar
        JOIN projects referenced_project
          ON referenced_project.workspace_id = ar.workspace_id
         AND referenced_project.id = ar.project_id
        WHERE ar.workspace_id = a.workspace_id
          AND ar.asset_id = a.id
          AND referenced_project.deleted_at IS NULL
      ) AS has_current_reference,
      EXISTS (
        SELECT 1
        FROM project_snapshots s
        JOIN projects p ON p.id = s.project_id
        WHERE p.workspace_id = a.workspace_id
          AND p.deleted_at IS NULL
          AND s.is_valid
          AND s.asset_manifest_json ? a.id::text
      ) AS has_checkpoint_reference,
      EXISTS (
        SELECT 1
        FROM community_posts cp
        WHERE cp.asset_id = a.id
          AND cp.source_workspace_id = a.workspace_id
          AND cp.status IN ('pending_review', 'published')
      ) AS has_community_reference,
      to_char(
        CASE
          WHEN a.status = 'pending' THEN GREATEST(a.updated_at, COALESCE(au.expires_at, a.updated_at))
          ELSE COALESCE(
            a.quota_released_at,
            a.deleted_at,
            a.updated_at,
            a.created_at
          )
        END AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS gc_eligible_at,
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
    FROM assets a
    LEFT JOIN asset_uploads au ON au.workspace_id = a.workspace_id AND au.asset_id = a.id
    ${lockClause}
  `;
}

async function readAssetBatch(
  client: Pick<DbClient, "query">,
  input: AssetMaintenanceInput,
) {
  const batchSize = validateAssetMaintenanceBatchSize(input.batchSize);
  const values: unknown[] = [];
  let cursorClause = "";
  if (input.cursor) {
    values.push(input.cursor.createdAt, input.cursor.id);
    cursorClause = "WHERE (a.created_at, a.id) > ($1::timestamptz, $2::uuid)";
  }
  values.push(batchSize);
  const result = await client.query<AssetMaintenanceRow>(
    `${assetSelect()} ${cursorClause} ORDER BY a.created_at, a.id LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

async function readCleanupAssetBatch(
  client: Pick<DbClient, "query">,
  input: AssetMaintenanceInput,
) {
  const batchSize = validateAssetMaintenanceBatchSize(input.batchSize);
  const values: unknown[] = [input.cutoff];
  let cursorClause = "";
  if (input.cursor) {
    values.push(input.cursor.createdAt, input.cursor.id);
    cursorClause = `
      AND (a.created_at, a.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)
    `;
  }
  values.push(batchSize);
  const result = await client.query<AssetMaintenanceRow>(
    `${assetSelect()}
      WHERE NOT EXISTS (
        SELECT 1
        FROM asset_references ar
        JOIN projects referenced_project
          ON referenced_project.workspace_id = ar.workspace_id
         AND referenced_project.id = ar.project_id
        WHERE ar.workspace_id = a.workspace_id
          AND ar.asset_id = a.id
          AND referenced_project.deleted_at IS NULL
      )
        AND NOT EXISTS (
          SELECT 1
          FROM project_snapshots s
          JOIN projects p ON p.id = s.project_id
          WHERE p.workspace_id = a.workspace_id
            AND p.deleted_at IS NULL
            AND s.is_valid
            AND s.asset_manifest_json ? a.id::text
        )
        AND NOT EXISTS (
          SELECT 1
          FROM community_posts cp
          WHERE cp.asset_id = a.id
            AND cp.source_workspace_id = a.workspace_id
            AND cp.status IN ('pending_review', 'published')
        )
        AND (
          CASE
            WHEN a.status = 'pending'
              THEN GREATEST(a.updated_at, COALESCE(au.expires_at, a.updated_at))
            ELSE COALESCE(
              a.quota_released_at,
              a.deleted_at,
              a.updated_at,
              a.created_at
            )
          END
        ) <= $1
        ${cursorClause}
      ORDER BY a.created_at, a.id
      LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

async function readLockedAsset(client: DbClient, assetId: string) {
  const locked = await client.query<{ id: string }>(
    `SELECT id::text FROM assets WHERE id = $1 FOR UPDATE SKIP LOCKED`,
    [assetId],
  );
  if (!locked.rows[0]) {
    return null;
  }

  // Read references in a new statement snapshot after the asset lock is held.
  const result = await client.query<AssetMaintenanceRow>(
    assetSelect("WHERE a.id = $1"),
    [assetId],
  );
  return result.rows[0] ?? null;
}

function nextCursor(rows: AssetMaintenanceRow[]) {
  const row = rows.at(-1);
  return row ? { createdAt: row.created_at_cursor, id: row.id } : null;
}

function retainedItem(
  row: AssetMaintenanceRow,
  reason: AssetMaintenanceReason,
): AssetMaintenanceItem {
  return {
    assetId: row.id,
    objectKey: row.object_key,
    byteSize: Number(row.byte_size),
    action: "retained",
    reason,
    statusBefore: row.status,
    statusAfter: row.status,
  };
}

async function preflightAsset(
  storage: AssetMaintenanceObjectStorage,
  row: AssetMaintenanceRow,
  cutoff: Date,
): Promise<AssetMaintenanceItem> {
  const reason = classifyAssetGcRetention({
    hasCurrentReference: row.has_current_reference,
    hasCheckpointReference: row.has_checkpoint_reference,
    hasCommunityReference: row.has_community_reference,
    gcEligibleAt: row.gc_eligible_at,
    cutoff,
  });
  const exists = await storage.objectExists(row.object_key);
  if (reason !== "eligible") {
    if (!exists && row.status === "completed") {
      return {
        ...retainedItem(row, "object_missing"),
        action: "missing_object",
      };
    }
    return retainedItem(row, reason);
  }
  if (exists) {
    return {
      ...retainedItem(row, "eligible"),
      action: "would_delete_asset_object",
      statusAfter: "deleted",
    };
  }
  if (row.status === "deleted") {
    return {
      ...retainedItem(row, "object_missing"),
      action: "already_deleted",
    };
  }
  return {
    ...retainedItem(row, "object_missing"),
    action: "would_finalize_missing_object",
    statusAfter: "deleted",
  };
}

async function applyAsset(
  pool: DbPool,
  storage: AssetMaintenanceObjectStorage,
  candidate: AssetMaintenanceRow,
  cutoff: Date,
): Promise<AssetMaintenanceItem> {
  return withTransaction(pool, async (client) => {
    const row = await readLockedAsset(client, candidate.id);
    if (!row) {
      return {
        ...retainedItem(candidate, "row_locked"),
        action: "skipped_locked",
      };
    }
    const reason = classifyAssetGcRetention({
      hasCurrentReference: row.has_current_reference,
      hasCheckpointReference: row.has_checkpoint_reference,
      hasCommunityReference: row.has_community_reference,
      gcEligibleAt: row.gc_eligible_at,
      cutoff,
    });
    const exists = await storage.objectExists(row.object_key);
    if (reason !== "eligible") {
      if (!exists && row.status === "completed") {
        return {
          ...retainedItem(row, "object_missing"),
          action: "missing_object",
        };
      }
      return retainedItem(row, reason);
    }
    if (exists) {
      await storage.deleteObject(row.object_key);
    } else if (row.status === "deleted") {
      return {
        ...retainedItem(row, "object_missing"),
        action: "already_deleted",
      };
    }

    await client.query(
      `UPDATE assets SET status = 'deleted', deleted_at = COALESCE(deleted_at, now()), updated_at = now() WHERE id = $1`,
      [row.id],
    );
    return {
      assetId: row.id,
      objectKey: row.object_key,
      byteSize: Number(row.byte_size),
      action: exists ? "asset_object_deleted" : "missing_object_finalized",
      reason: exists ? "eligible" : "object_missing",
      statusBefore: row.status,
      statusAfter: "deleted",
    };
  });
}

async function processAssetBatch(
  pool: DbPool,
  storage: AssetMaintenanceObjectStorage,
  rows: AssetMaintenanceRow[],
  input: AssetMaintenanceInput,
) {
  const items: AssetMaintenanceItem[] = [];
  for (const row of rows) {
    items.push(
      input.apply
        ? await applyAsset(pool, storage, row, input.cutoff)
        : await preflightAsset(storage, row, input.cutoff),
    );
  }
  return { items, nextCursor: nextCursor(rows) };
}

async function existingObjectKeys(
  client: Pick<DbClient, "query">,
  objectKeys: string[],
) {
  if (objectKeys.length === 0) {
    return new Set<string>();
  }
  const result = await client.query<{ object_key: string }>(
    `SELECT object_key FROM assets WHERE object_key = ANY($1::text[])`,
    [objectKeys],
  );
  return new Set(result.rows.map((row) => row.object_key));
}

export function createPostgresAssetMaintenanceService(
  pool: DbPool,
  storage: AssetMaintenanceObjectStorage,
): PostgresAssetMaintenanceService {
  return {
    async maintainAssetBatch(input) {
      const rows = await readAssetBatch(pool, input);
      return processAssetBatch(pool, storage, rows, input);
    },

    async maintainOrphanObjectPage(input) {
      const page = await storage.listObjectsPage({
        prefix: MANAGED_ASSET_OBJECT_PREFIX,
        startAfter: input.startAfter,
        maxKeys: validateAssetMaintenanceBatchSize(input.batchSize),
      });
      const recognizedKeys = page.objects
        .filter((object) => parseManagedAssetObjectKey(object.objectKey))
        .map((object) => object.objectKey);
      const storedKeys = await existingObjectKeys(pool, recognizedKeys);
      const items: OrphanObjectMaintenanceItem[] = [];

      for (const object of page.objects) {
        if (!parseManagedAssetObjectKey(object.objectKey)) {
          items.push({
            objectKey: object.objectKey,
            action: "ignored_unmanaged",
            reason: "unrecognized_key",
          });
          continue;
        }
        if (storedKeys.has(object.objectKey)) {
          items.push({
            objectKey: object.objectKey,
            action: "retained",
            reason: "database_record_exists",
          });
          continue;
        }
        if (!canDeleteOrphanObject({ ...object, cutoff: input.cutoff })) {
          items.push({
            objectKey: object.objectKey,
            action: "retained",
            reason: "grace_period",
          });
          continue;
        }
        if (!input.apply) {
          items.push({
            objectKey: object.objectKey,
            action: "would_delete_orphan_object",
            reason: "orphaned",
          });
          continue;
        }

        const rechecked = await existingObjectKeys(pool, [object.objectKey]);
        if (rechecked.has(object.objectKey)) {
          items.push({
            objectKey: object.objectKey,
            action: "retained",
            reason: "database_record_exists",
          });
          continue;
        }
        await storage.deleteObject(object.objectKey);
        items.push({
          objectKey: object.objectKey,
          action: "orphan_object_deleted",
          reason: "orphaned",
        });
      }

      return { items, nextStartAfter: page.nextStartAfter };
    },

    async cleanupUnreferencedAssetBatch(input) {
      const rows = await readCleanupAssetBatch(pool, input);
      return processAssetBatch(pool, storage, rows, input);
    },
  };
}
