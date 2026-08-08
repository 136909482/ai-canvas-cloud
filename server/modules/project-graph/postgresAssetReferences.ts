import { type DbClient } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import {
  collectAssetIdsFromNodeReferenceChanges,
  type NodeAssetReferenceChange,
} from "./assetReferences.js";
import {
  lockWorkspaceStorageQuota,
  readWorkspaceStorageUsage,
} from "../workspaces/usage.js";

interface ReferencedAssetRow {
  asset_id: string;
  status: string;
}

export type CompletedAssetCheck = "ready" | "missing" | "not_ready";

export async function checkCompletedAssetIds(
  client: Pick<DbClient, "query">,
  workspaceId: string,
  assetIds: string[],
  options: { lock?: boolean } = {},
) {
  if (assetIds.length === 0) {
    return "ready" satisfies CompletedAssetCheck;
  }

  const result = await client.query<ReferencedAssetRow>(
    `
      SELECT id::text AS asset_id, status
      FROM assets
      WHERE workspace_id = $1
        AND id = ANY($2::uuid[])
        AND deleted_at IS NULL
        AND status <> 'deleted'
      ${options.lock ? "FOR SHARE" : ""}
    `,
    [workspaceId, assetIds],
  );
  if (result.rows.length !== assetIds.length) {
    return "missing" satisfies CompletedAssetCheck;
  }
  if (result.rows.some((row) => row.status !== "completed")) {
    return "not_ready" satisfies CompletedAssetCheck;
  }

  return "ready" satisfies CompletedAssetCheck;
}

export async function requireCompletedAssetIds(
  client: DbClient,
  workspaceId: string,
  assetIds: string[],
) {
  const result = await checkCompletedAssetIds(client, workspaceId, assetIds, {
    lock: true,
  });
  if (result === "missing") {
    throw new AuthServiceError({
      statusCode: 404,
      apiCode: "RESOURCE_NOT_FOUND",
      message: "Referenced asset not found",
    });
  }
  if (result === "not_ready") {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: "ASSET_NOT_READY",
      message: "Referenced asset is not ready",
    });
  }

  return assetIds;
}

export async function requireCompletedAssetReferences(
  client: DbClient,
  workspaceId: string,
  changes: NodeAssetReferenceChange[],
) {
  return requireCompletedAssetIds(
    client,
    workspaceId,
    collectAssetIdsFromNodeReferenceChanges(changes),
  );
}

async function releaseRemovedAssetQuota(
  client: DbClient,
  workspaceId: string,
  projectId: string,
  nodeId: string | null,
) {
  await client.query(
    `
      UPDATE assets a
      SET quota_released_at = COALESCE(quota_released_at, now()), updated_at = now()
      WHERE a.workspace_id = $1
        AND a.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM asset_references removed_reference
          WHERE removed_reference.workspace_id = a.workspace_id
            AND removed_reference.asset_id = a.id
            AND removed_reference.project_id = $2
            AND ($3::text IS NULL OR removed_reference.node_id = $3)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM asset_references remaining_reference
          JOIN projects remaining_project
            ON remaining_project.workspace_id = remaining_reference.workspace_id
           AND remaining_project.id = remaining_reference.project_id
          WHERE remaining_reference.workspace_id = a.workspace_id
            AND remaining_reference.asset_id = a.id
            AND remaining_project.deleted_at IS NULL
            AND NOT (
              remaining_reference.project_id = $2
              AND ($3::text IS NULL OR remaining_reference.node_id = $3)
            )
        )
    `,
    [workspaceId, projectId, nodeId],
  );
}

async function restoreReleasedAssetQuota(
  client: DbClient,
  workspaceId: string,
  assetIds: string[],
) {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) return;

  const rows = await client.query<{ bytes: string | number }>(
    `
      SELECT COALESCE(SUM(byte_size), 0) AS bytes
      FROM assets
      WHERE workspace_id = $1
        AND id = ANY($2::uuid[])
        AND quota_released_at IS NOT NULL
        AND deleted_at IS NULL
        AND status <> 'deleted'
    `,
    [workspaceId, uniqueAssetIds],
  );
  const restoreBytes = Number(rows.rows[0]?.bytes ?? 0);
  if (restoreBytes <= 0) return;

  await lockWorkspaceStorageQuota(client, workspaceId);
  const usage = await readWorkspaceStorageUsage(client, workspaceId);
  if (usage.storage.totalBytes + restoreBytes > usage.storage.quotaBytes) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: "QUOTA_EXCEEDED",
      message: "Storage quota is insufficient to restore deleted assets",
      details: { requestedBytes: restoreBytes },
    });
  }

  await client.query(
    `
      UPDATE assets
      SET quota_released_at = NULL, updated_at = now()
      WHERE workspace_id = $1
        AND id = ANY($2::uuid[])
        AND quota_released_at IS NOT NULL
        AND deleted_at IS NULL
        AND status <> 'deleted'
    `,
    [workspaceId, uniqueAssetIds],
  );
}

async function insertNodeAssetReferences(
  client: DbClient,
  workspaceId: string,
  projectId: string,
  changes: NodeAssetReferenceChange[],
) {
  const rows = changes.flatMap((change) =>
    change.references.map((reference) => ({
      nodeId: change.nodeId,
      ...reference,
    })),
  );
  if (rows.length === 0) {
    return;
  }

  await restoreReleasedAssetQuota(
    client,
    workspaceId,
    collectAssetIdsFromNodeReferenceChanges(changes),
  );

  await client.query(
    `
      INSERT INTO asset_references (
        workspace_id, asset_id, project_id, node_id, reference_role
      )
      SELECT $1, asset_rows.asset_id, $2, asset_rows.node_id, asset_rows.reference_role
      FROM unnest($3::uuid[], $4::text[], $5::text[])
        AS asset_rows(asset_id, node_id, reference_role)
    `,
    [
      workspaceId,
      projectId,
      rows.map((row) => row.assetId),
      rows.map((row) => row.nodeId),
      rows.map((row) => row.referenceRole),
    ],
  );
}

export async function replaceNodeAssetReferences(
  client: DbClient,
  workspaceId: string,
  projectId: string,
  change: NodeAssetReferenceChange,
) {
  await releaseRemovedAssetQuota(client, workspaceId, projectId, change.nodeId);
  await client.query(
    `DELETE FROM asset_references WHERE workspace_id = $1 AND project_id = $2 AND node_id = $3`,
    [workspaceId, projectId, change.nodeId],
  );
  await insertNodeAssetReferences(client, workspaceId, projectId, [change]);
}

export async function replaceProjectNodeAssetReferences(
  client: DbClient,
  workspaceId: string,
  projectId: string,
  changes: NodeAssetReferenceChange[],
) {
  await releaseRemovedAssetQuota(client, workspaceId, projectId, null);
  await client.query(
    `DELETE FROM asset_references WHERE workspace_id = $1 AND project_id = $2 AND node_id IS NOT NULL`,
    [workspaceId, projectId],
  );
  await insertNodeAssetReferences(client, workspaceId, projectId, changes);
}
