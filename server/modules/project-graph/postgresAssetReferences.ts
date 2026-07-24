import { type DbClient } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import {
  collectAssetIdsFromNodeReferenceChanges,
  type NodeAssetReferenceChange,
} from "./assetReferences.js";

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
  await client.query(
    `DELETE FROM asset_references WHERE workspace_id = $1 AND project_id = $2 AND node_id IS NOT NULL`,
    [workspaceId, projectId],
  );
  await insertNodeAssetReferences(client, workspaceId, projectId, changes);
}
