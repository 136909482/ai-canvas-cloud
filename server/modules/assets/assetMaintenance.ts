import type { AssetObjectStorage } from "./service.js";

export const MANAGED_ASSET_OBJECT_PREFIX = "workspaces/";
export const ASSET_MAINTENANCE_DEFAULT_BATCH_SIZE = 100;
export const ASSET_MAINTENANCE_MAX_BATCH_SIZE = 500;
export const ASSET_GC_DEFAULT_GRACE_HOURS = 7 * 24;
export const ASSET_GC_MAX_GRACE_HOURS = 365 * 24;

const UUID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MANAGED_OBJECT_KEY_PATTERN = new RegExp(
  `^workspaces/(${UUID_SEGMENT})/(?:workspace|projects/(${UUID_SEGMENT}))/(?:uploads|edits|crops|thumbnails|previews|videos|generated/[0-9]{4}-[0-9]{2}-[0-9]{2})/(${UUID_SEGMENT})\\.(?:jpg|png|webp|mp4|webm|mov)$`,
  "i",
);

export type AssetGcStatus =
  "pending" | "completed" | "failed" | "quarantined" | "deleted";
export type AssetGcRetentionReason =
  | "current_reference"
  | "checkpoint_reference"
  | "community_reference"
  | "grace_period"
  | "eligible";

export interface AssetMaintenanceObject {
  objectKey: string;
  byteSize: number;
  lastModified: string | null;
}

export interface AssetMaintenanceObjectStorage extends AssetObjectStorage {
  objectExists: (objectKey: string) => Promise<boolean>;
  listObjectsPage: (input: {
    prefix: typeof MANAGED_ASSET_OBJECT_PREFIX;
    startAfter?: string | null;
    maxKeys: number;
  }) => Promise<{
    objects: AssetMaintenanceObject[];
    nextStartAfter: string | null;
  }>;
  deleteObject: (objectKey: string) => Promise<void>;
}

export function validateAssetMaintenanceBatchSize(value: number | undefined) {
  const batchSize = value ?? ASSET_MAINTENANCE_DEFAULT_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > ASSET_MAINTENANCE_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batchSize must be between 1 and ${ASSET_MAINTENANCE_MAX_BATCH_SIZE}`,
    );
  }
  return batchSize;
}

export function validateAssetGcGraceHours(value: number | undefined) {
  const graceHours = value ?? ASSET_GC_DEFAULT_GRACE_HOURS;
  if (
    !Number.isInteger(graceHours) ||
    graceHours < 1 ||
    graceHours > ASSET_GC_MAX_GRACE_HOURS
  ) {
    throw new Error(
      `graceHours must be between 1 and ${ASSET_GC_MAX_GRACE_HOURS}`,
    );
  }
  return graceHours;
}

export function parseManagedAssetObjectKey(objectKey: string) {
  const match = MANAGED_OBJECT_KEY_PATTERN.exec(objectKey);
  if (!match) {
    return null;
  }
  return {
    workspaceId: match[1]!.toLowerCase(),
    projectId: match[2]?.toLowerCase() ?? null,
    assetId: match[3]!.toLowerCase(),
  };
}

export function classifyAssetGcRetention(input: {
  hasCurrentReference: boolean;
  hasCheckpointReference: boolean;
  hasCommunityReference: boolean;
  gcEligibleAt: string;
  cutoff: Date;
}): AssetGcRetentionReason {
  if (input.hasCurrentReference) {
    return "current_reference";
  }
  if (input.hasCheckpointReference) {
    return "checkpoint_reference";
  }
  if (input.hasCommunityReference) {
    return "community_reference";
  }
  if (new Date(input.gcEligibleAt).getTime() > input.cutoff.getTime()) {
    return "grace_period";
  }
  return "eligible";
}

export function canDeleteOrphanObject(input: {
  objectKey: string;
  lastModified: string | null;
  cutoff: Date;
}) {
  if (!parseManagedAssetObjectKey(input.objectKey) || !input.lastModified) {
    return false;
  }
  const modifiedAt = new Date(input.lastModified).getTime();
  return Number.isFinite(modifiedAt) && modifiedAt <= input.cutoff.getTime();
}
