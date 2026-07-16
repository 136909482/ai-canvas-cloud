import { withTransaction, type DbClient, type DbPool } from '../../db/postgres.js'
import {
  checkCompletedAssetIds,
  requireCompletedAssetIds,
} from '../project-graph/postgresAssetReferences.js'
import {
  assessCheckpointAssetManifest,
  type CheckpointAssetManifestAssessment,
} from './checkpointAssetManifestRepair.js'

export const CHECKPOINT_ASSET_REPAIR_DEFAULT_BATCH_SIZE = 100
export const CHECKPOINT_ASSET_REPAIR_MAX_BATCH_SIZE = 500

interface SnapshotRepairRow {
  id: string
  project_id: string
  workspace_id: string
  record_json: unknown
  asset_manifest_json: unknown
  is_valid: boolean
  is_saved_snapshot: boolean
  created_at_cursor: string
}

export interface CheckpointAssetRepairCursor {
  createdAt: string
  id: string
}

export type CheckpointAssetRepairAction =
  | 'unchanged'
  | 'would_repair'
  | 'manifest_repaired'
  | 'would_invalidate'
  | 'invalidated'
  | 'preserved_invalid'
  | 'skipped_locked'

export type CheckpointAssetRepairReason =
  | 'already_consistent'
  | 'empty'
  | 'mismatch'
  | 'noncanonical'
  | 'record_invalid'
  | 'manifest_invalid'
  | 'asset_unavailable'
  | 'already_invalid'
  | 'row_locked'

export interface CheckpointAssetRepairItem {
  checkpointId: string
  projectId: string
  action: CheckpointAssetRepairAction
  reason: CheckpointAssetRepairReason
  assetCount: number | null
  isSavedSnapshot: boolean
  isValidBefore: boolean
  isValidAfter: boolean
}

export interface CheckpointAssetRepairBatch {
  items: CheckpointAssetRepairItem[]
  nextCursor: CheckpointAssetRepairCursor | null
}

export interface CheckpointAssetRepairBatchInput {
  cursor?: CheckpointAssetRepairCursor | null
  batchSize?: number
}

export interface PostgresCheckpointAssetManifestRepairService {
  preflightBatch: (input?: CheckpointAssetRepairBatchInput) => Promise<CheckpointAssetRepairBatch>
  applyBatch: (input?: CheckpointAssetRepairBatchInput) => Promise<CheckpointAssetRepairBatch>
}

function validateBatchSize(value: number | undefined) {
  const batchSize = value ?? CHECKPOINT_ASSET_REPAIR_DEFAULT_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > CHECKPOINT_ASSET_REPAIR_MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be between 1 and ${CHECKPOINT_ASSET_REPAIR_MAX_BATCH_SIZE}`)
  }
  return batchSize
}

async function readSnapshotBatch(
  client: Pick<DbClient, 'query'>,
  input: CheckpointAssetRepairBatchInput,
) {
  const batchSize = validateBatchSize(input.batchSize)
  const values: unknown[] = []
  let cursorClause = ''
  if (input.cursor) {
    values.push(input.cursor.createdAt, input.cursor.id)
    cursorClause = 'WHERE (s.created_at, s.id) > ($1::timestamptz, $2::uuid)'
  }
  values.push(batchSize)

  const result = await client.query<SnapshotRepairRow>(
    `
      SELECT
        s.id::text,
        s.project_id::text,
        p.workspace_id::text,
        s.record_json,
        s.asset_manifest_json,
        s.is_valid,
        COALESCE(p.saved_snapshot_id = s.id, false) AS is_saved_snapshot,
        to_char(
          s.created_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS created_at_cursor
      FROM project_snapshots s
      JOIN projects p ON p.id = s.project_id
      ${cursorClause}
      ORDER BY s.created_at, s.id
      LIMIT $${values.length}
    `,
    values,
  )

  return result.rows
}

async function readLockedSnapshot(client: DbClient, snapshotId: string) {
  const result = await client.query<SnapshotRepairRow>(
    `
      SELECT
        s.id::text,
        s.project_id::text,
        p.workspace_id::text,
        s.record_json,
        s.asset_manifest_json,
        s.is_valid,
        COALESCE(p.saved_snapshot_id = s.id, false) AS is_saved_snapshot,
        to_char(
          s.created_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS created_at_cursor
      FROM project_snapshots s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1
      FOR UPDATE OF s SKIP LOCKED
    `,
    [snapshotId],
  )
  return result.rows[0] ?? null
}

function nextCursor(rows: SnapshotRepairRow[]) {
  const row = rows.at(-1)
  return row ? { createdAt: row.created_at_cursor, id: row.id } : null
}

function invalidItem(
  row: SnapshotRepairRow,
  reason: CheckpointAssetRepairReason,
  apply: boolean,
): CheckpointAssetRepairItem {
  const action = row.is_valid
    ? (apply ? 'invalidated' : 'would_invalidate')
    : 'preserved_invalid'
  return {
    checkpointId: row.id,
    projectId: row.project_id,
    action,
    reason: row.is_valid ? reason : 'already_invalid',
    assetCount: null,
    isSavedSnapshot: row.is_saved_snapshot,
    isValidBefore: row.is_valid,
    isValidAfter: false,
  }
}

async function assessAssets(
  client: Pick<DbClient, 'query'>,
  row: SnapshotRepairRow,
  assessment: Exclude<CheckpointAssetManifestAssessment, { status: 'invalid' }>,
) {
  return checkCompletedAssetIds(client, row.workspace_id, assessment.manifest)
}

async function preflightRow(pool: DbPool, row: SnapshotRepairRow): Promise<CheckpointAssetRepairItem> {
  const assessment = assessCheckpointAssetManifest({
    projectId: row.project_id,
    record: row.record_json,
    storedManifest: row.asset_manifest_json,
  })
  if (assessment.status === 'invalid') {
    return invalidItem(row, assessment.reason, false)
  }
  if (!row.is_valid) {
    return invalidItem(row, 'already_invalid', false)
  }
  if (await assessAssets(pool, row, assessment) !== 'ready') {
    return invalidItem(row, 'asset_unavailable', false)
  }
  return {
    checkpointId: row.id,
    projectId: row.project_id,
    action: assessment.status === 'repairable' ? 'would_repair' : 'unchanged',
    reason: assessment.status === 'repairable' ? assessment.reason : 'already_consistent',
    assetCount: assessment.manifest.length,
    isSavedSnapshot: row.is_saved_snapshot,
    isValidBefore: row.is_valid,
    isValidAfter: row.is_valid,
  }
}

async function markInvalid(client: DbClient, row: SnapshotRepairRow, reason: CheckpointAssetRepairReason) {
  if (row.is_valid) {
    await client.query(`UPDATE project_snapshots SET is_valid = false WHERE id = $1`, [row.id])
  }
  return invalidItem(row, reason, true)
}

async function applyRow(pool: DbPool, candidate: SnapshotRepairRow): Promise<CheckpointAssetRepairItem> {
  return withTransaction(pool, async (client) => {
    const row = await readLockedSnapshot(client, candidate.id)
    if (!row) {
      return {
        checkpointId: candidate.id,
        projectId: candidate.project_id,
        action: 'skipped_locked',
        reason: 'row_locked',
        assetCount: null,
        isSavedSnapshot: candidate.is_saved_snapshot,
        isValidBefore: candidate.is_valid,
        isValidAfter: candidate.is_valid,
      }
    }

    const assessment = assessCheckpointAssetManifest({
      projectId: row.project_id,
      record: row.record_json,
      storedManifest: row.asset_manifest_json,
    })
    if (assessment.status === 'invalid') {
      return markInvalid(client, row, assessment.reason)
    }
    if (!row.is_valid) {
      return invalidItem(row, 'already_invalid', true)
    }

    try {
      await requireCompletedAssetIds(client, row.workspace_id, assessment.manifest)
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'apiCode' in error
        && (error.apiCode === 'RESOURCE_NOT_FOUND' || error.apiCode === 'ASSET_NOT_READY')
      ) {
        return markInvalid(client, row, 'asset_unavailable')
      }
      throw error
    }

    if (assessment.status === 'repairable') {
      await client.query(
        `UPDATE project_snapshots SET asset_manifest_json = $2::jsonb WHERE id = $1`,
        [row.id, JSON.stringify(assessment.manifest)],
      )
    }

    return {
      checkpointId: row.id,
      projectId: row.project_id,
      action: assessment.status === 'repairable' ? 'manifest_repaired' : 'unchanged',
      reason: assessment.status === 'repairable' ? assessment.reason : 'already_consistent',
      assetCount: assessment.manifest.length,
      isSavedSnapshot: row.is_saved_snapshot,
      isValidBefore: row.is_valid,
      isValidAfter: row.is_valid,
    }
  })
}

export function createPostgresCheckpointAssetManifestRepairService(
  pool: DbPool,
): PostgresCheckpointAssetManifestRepairService {
  return {
    async preflightBatch(input = {}) {
      const rows = await readSnapshotBatch(pool, input)
      const items: CheckpointAssetRepairItem[] = []
      for (const row of rows) {
        items.push(await preflightRow(pool, row))
      }
      return {
        items,
        nextCursor: nextCursor(rows),
      }
    },
    async applyBatch(input = {}) {
      const rows = await readSnapshotBatch(pool, input)
      const items: CheckpointAssetRepairItem[] = []
      for (const row of rows) {
        items.push(await applyRow(pool, row))
      }
      return { items, nextCursor: nextCursor(rows) }
    },
  }
}
