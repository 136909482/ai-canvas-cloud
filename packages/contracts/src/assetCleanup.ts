export interface AssetCleanupRequest {
  apply: boolean;
}

export interface AssetCleanupSummary {
  mode: "preview" | "apply";
  graceHours: number;
  cutoff: string;
  scannedAssetCount: number;
  reclaimableObjectCount: number;
  reclaimableBytes: number;
  deletedObjectCount: number;
  deletedBytes: number;
  missingObjectCount: number;
  finalizedMissingAssetCount: number;
  retainedAssetCount: number;
  truncated: boolean;
  completedAt: string;
}

export function validateAssetCleanupRequest(
  value: unknown,
): AssetCleanupRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Asset cleanup request must be an object");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "apply")) {
    throw new Error("Asset cleanup request contains unsupported fields");
  }
  if (typeof input.apply !== "boolean") {
    throw new Error("apply must be a boolean");
  }
  return { apply: input.apply };
}

const ASSET_CLEANUP_SUMMARY_KEYS = [
  "mode",
  "graceHours",
  "cutoff",
  "scannedAssetCount",
  "reclaimableObjectCount",
  "reclaimableBytes",
  "deletedObjectCount",
  "deletedBytes",
  "missingObjectCount",
  "finalizedMissingAssetCount",
  "retainedAssetCount",
  "truncated",
  "completedAt",
] as const;

function nonNegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a timestamp`);
  }
  return value;
}

export function validateAssetCleanupSummary(
  value: unknown,
): AssetCleanupSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Asset cleanup summary must be an object");
  }
  const summary = value as Record<string, unknown>;
  const supported = new Set<string>(ASSET_CLEANUP_SUMMARY_KEYS);
  if (Object.keys(summary).some((key) => !supported.has(key))) {
    throw new Error("Asset cleanup summary contains unsupported fields");
  }
  if (summary.mode !== "preview" && summary.mode !== "apply") {
    throw new Error("mode must be preview or apply");
  }
  if (typeof summary.truncated !== "boolean") {
    throw new Error("truncated must be a boolean");
  }
  return {
    mode: summary.mode,
    graceHours: nonNegativeInteger(summary.graceHours, "graceHours"),
    cutoff: timestamp(summary.cutoff, "cutoff"),
    scannedAssetCount: nonNegativeInteger(
      summary.scannedAssetCount,
      "scannedAssetCount",
    ),
    reclaimableObjectCount: nonNegativeInteger(
      summary.reclaimableObjectCount,
      "reclaimableObjectCount",
    ),
    reclaimableBytes: nonNegativeInteger(
      summary.reclaimableBytes,
      "reclaimableBytes",
    ),
    deletedObjectCount: nonNegativeInteger(
      summary.deletedObjectCount,
      "deletedObjectCount",
    ),
    deletedBytes: nonNegativeInteger(summary.deletedBytes, "deletedBytes"),
    missingObjectCount: nonNegativeInteger(
      summary.missingObjectCount,
      "missingObjectCount",
    ),
    finalizedMissingAssetCount: nonNegativeInteger(
      summary.finalizedMissingAssetCount,
      "finalizedMissingAssetCount",
    ),
    retainedAssetCount: nonNegativeInteger(
      summary.retainedAssetCount,
      "retainedAssetCount",
    ),
    truncated: summary.truncated,
    completedAt: timestamp(summary.completedAt, "completedAt"),
  };
}
