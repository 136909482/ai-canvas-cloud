import { hasDuplicateJsonObjectKeys } from "@ai-canvas-cloud/shared";

export const MIGRATION_PACKAGE_SCHEMA_VERSION = 1 as const;
export const MIGRATION_PROJECT_RECORD_SCHEMA_VERSION = 1 as const;
export const MIGRATION_GRAPH_SCHEMA_VERSION = 1 as const;
export const MIGRATION_ASSET_MANIFEST_SCHEMA_VERSION = 1 as const;
export const MIGRATION_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export const migrationPackagePaths = {
  manifest: "manifest.json",
  project: "project.json",
  graph: "graph.json",
  assets: "assets.json",
  checkpoint: "checkpoint.json",
  assetRoot: "assets",
} as const;

export interface MigrationPackageLimits {
  maxFileCount: number;
  maxTotalUncompressedBytes: number;
  maxFileUncompressedBytes: number;
  maxPathLength: number;
  maxPathSegmentLength: number;
  maxDirectoryDepth: number;
  maxCompressionRatio: number;
  maxTotalCompressionRatio: number;
  maxJsonDepth: number;
  maxJsonEntries: number;
}

export const defaultMigrationPackageLimits: Readonly<MigrationPackageLimits> =
  Object.freeze({
    maxFileCount: 4_096,
    maxTotalUncompressedBytes: 10 * 1024 * 1024 * 1024,
    maxFileUncompressedBytes: 2 * 1024 * 1024 * 1024,
    maxPathLength: 512,
    maxPathSegmentLength: 128,
    maxDirectoryDepth: 8,
    maxCompressionRatio: 100,
    maxTotalCompressionRatio: 40,
    maxJsonDepth: 32,
    maxJsonEntries: 100_000,
  });

export type MigrationPackageSourcePlatform = "web" | "electron" | "cloud";
export type MigrationPackageEntryKind = "file" | "directory" | "symlink";

export interface MigrationPackageArchiveEntry {
  path: string;
  kind: MigrationPackageEntryKind;
  uncompressedSize: number;
  compressedSize: number;
  sha256?: string;
}

export interface MigrationPackageFileDescriptor {
  path: string;
  byteSize: number;
  sha256: string;
}

export interface MigrationPackageManifest {
  packageSchemaVersion: typeof MIGRATION_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  sourcePlatform: MigrationPackageSourcePlatform;
  exportedAt: string;
  project: {
    id: string;
    version: number;
    sequence: number;
  };
  fileCount: number;
  totalByteSize: number;
  contentSha256: string;
  files: MigrationPackageFileDescriptor[];
}

export type MigrationJsonPrimitive = string | number | boolean | null;
export type MigrationJsonValue =
  MigrationJsonPrimitive | MigrationJsonObject | MigrationJsonValue[];
export interface MigrationJsonObject {
  [key: string]: MigrationJsonValue;
}

export interface MigrationCanvasSnapshot {
  nodes: MigrationJsonObject[];
  edges: MigrationJsonObject[];
}

export interface MigrationTaskQueueSnapshot {
  tasks: MigrationJsonObject[];
}

export interface MigrationProjectSnapshot {
  schemaVersion: typeof MIGRATION_PROJECT_RECORD_SCHEMA_VERSION;
  canvas: MigrationCanvasSnapshot;
  taskQueue: MigrationTaskQueueSnapshot;
}

export interface MigrationProjectRecord {
  id: string;
  name: string;
  savedSnapshot: MigrationProjectSnapshot;
  workingSnapshot: MigrationProjectSnapshot;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  archivedAt: string | null;
}

export interface MigrationProjectGraphNode {
  id: string;
  nodeType: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  zIndex?: number;
  parentNodeId?: string | null;
  dataSchemaVersion: number;
  data: MigrationJsonObject;
  presentation?: MigrationJsonObject;
}

export interface MigrationProjectGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  edgeType?: string | null;
  data?: MigrationJsonObject;
}

export interface MigrationProjectGraph {
  schemaVersion: typeof MIGRATION_GRAPH_SCHEMA_VERSION;
  projectId: string;
  version: number;
  sequence: number;
  nodes: MigrationProjectGraphNode[];
  edges: MigrationProjectGraphEdge[];
}

export type MigrationAssetKind =
  "upload" | "generated" | "edit" | "crop" | "thumbnail" | "preview" | "video";

export interface MigrationPackageAsset {
  logicalAssetId: string;
  filePath: string;
  originalFileName: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  assetKind: MigrationAssetKind;
}

export interface MigrationAssetManifest {
  schemaVersion: typeof MIGRATION_ASSET_MANIFEST_SCHEMA_VERSION;
  assets: MigrationPackageAsset[];
}

export interface MigrationCheckpointRecord {
  schemaVersion: typeof MIGRATION_PROJECT_RECORD_SCHEMA_VERSION;
  project: {
    id: string;
    name: string;
    version: number;
    lastSequence: number;
  };
  canvas: {
    nodes: MigrationProjectGraphNode[];
    edges: MigrationProjectGraphEdge[];
  };
  taskQueue: MigrationTaskQueueSnapshot;
}

export interface MigrationPackageCheckpoint {
  schemaVersion: typeof MIGRATION_CHECKPOINT_SCHEMA_VERSION;
  id: string;
  projectId: string;
  projectVersion: number;
  sequence: number;
  checkpointType: "manual" | "periodic" | "import" | "pre_restore";
  createdAt: string;
  assetIds: string[];
  record: MigrationCheckpointRecord;
}

export interface MigrationPackageContractInput {
  manifest: unknown;
  projectRecord: unknown;
  graph: unknown;
  assetManifest: unknown;
  checkpoint?: unknown;
  archiveEntries: readonly MigrationPackageArchiveEntry[];
  limits?: Partial<MigrationPackageLimits>;
}

export interface ValidatedMigrationPackageContract {
  manifest: MigrationPackageManifest;
  projectRecord: MigrationProjectRecord;
  graph: MigrationProjectGraph;
  assetManifest: MigrationAssetManifest;
  checkpoint: MigrationPackageCheckpoint | null;
  archiveEntries: MigrationPackageArchiveEntry[];
}

export type MigrationImportStatus =
  | "prepared"
  | "uploading"
  | "validating"
  | "ready"
  | "committing"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export type MigrationImportConflictType =
  | "none"
  | "project_exists"
  | "project_id_unavailable"
  | "source_id_incompatible";

export type MigrationImportConflictStrategy = "copy" | "replace";

export interface PrepareMigrationImportRequest {
  idempotencyKey: string;
  manifest: MigrationPackageManifest;
  projectRecord: MigrationProjectRecord;
  graph: MigrationProjectGraph;
  assetManifest: MigrationAssetManifest;
  checkpoint: MigrationPackageCheckpoint | null;
  archiveEntries: MigrationPackageArchiveEntry[];
}

export interface MigrationImportAssetUploadItem {
  logicalAssetId: string;
  filePath: string;
  originalFileName: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  assetKind: MigrationAssetKind;
  required: true;
}

export interface MigrationImportSummary {
  id: string;
  status: MigrationImportStatus;
  packageId: string;
  sourcePlatform: MigrationPackageSourcePlatform;
  project: {
    sourceId: string;
    name: string;
    version: number;
    sequence: number;
  };
  conflict: {
    type: MigrationImportConflictType;
    requiresResolution: boolean;
    targetProject: {
      id: string;
      name: string;
      expectedVersion: number;
      expectedSequence: number;
      archivedAt: string | null;
    } | null;
  };
  allowedStrategies: MigrationImportConflictStrategy[];
  estimates: {
    assetCount: number;
    fileCount: number;
    totalBytes: number;
    estimatedStorageBytes: number;
    availableBytesAtPrepare: number;
  };
  progress: {
    completedFileCount: number;
    completedBytes: number;
    retryCount: number;
  };
  uploads: MigrationImportAssetUploadItem[];
  error: {
    code: string;
    message: string;
  } | null;
  cancelRequestedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationImportResponse {
  import: MigrationImportSummary;
}

export type MigrationImportAssetUploadStatus =
  | "pending"
  | "uploading"
  | "validating"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export type MigrationImportAssetUploadMode = "single" | "multipart";

export interface MigrationImportAssetUploadPart {
  partNumber: number;
  byteSize: number;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface MigrationImportAssetUploadSummary {
  id: string;
  importId: string;
  logicalAssetId: string;
  status: MigrationImportAssetUploadStatus;
  mode: MigrationImportAssetUploadMode;
  expectedMimeType: string;
  expectedByteSize: number;
  expectedSha256: string;
  partSize: number;
  partCount: number;
  completedParts: number[];
  uploadedByteSize: number;
  retryCount: number;
  directUpload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  } | null;
  parts: MigrationImportAssetUploadPart[];
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationImportAssetUploadResponse {
  upload: MigrationImportAssetUploadSummary;
}

export type MigrationImportCommitStrategy = "copy" | "replace";

export interface CommitMigrationImportRequest {
  idempotencyKey: string;
  strategy: MigrationImportCommitStrategy;
  expectedVersion?: number;
  expectedSequence?: number;
  confirmReplace?: boolean;
}

export interface MigrationImportCommitResponse {
  importId: string;
  status: "completed";
  strategy: MigrationImportCommitStrategy;
  project: {
    id: string;
    name: string;
    version: number;
    sequence: number;
  };
  assetCount: number;
  checkpoint: {
    id: string;
    projectVersion: number;
    sequence: number;
  } | null;
}

export interface CompleteMigrationImportAssetPartRequest {
  etag: string;
  byteSize: number;
}

export interface CompleteMigrationImportAssetUploadRequest {
  parts?: Record<string, CompleteMigrationImportAssetPartRequest>;
}

export type MigrationPackageValidationCode =
  | "UNKNOWN_SCHEMA"
  | "INVALID_MANIFEST"
  | "INVALID_PROJECT_RECORD"
  | "INVALID_GRAPH"
  | "INVALID_ASSET_MANIFEST"
  | "INVALID_CHECKPOINT"
  | "INVALID_PATH"
  | "DUPLICATE_PATH"
  | "SYMLINK_NOT_ALLOWED"
  | "PACKAGE_LIMIT_EXCEEDED"
  | "COMPRESSION_LIMIT_EXCEEDED"
  | "DUPLICATE_LOGICAL_ASSET_ID"
  | "REFERENCE_MISSING"
  | "SENSITIVE_FIELD"
  | "NON_CANONICAL";

export class MigrationPackageValidationError extends Error {
  readonly code: MigrationPackageValidationCode;
  readonly field: string;

  constructor(
    code: MigrationPackageValidationCode,
    field: string,
    message: string,
  ) {
    super(message);
    this.name = "MigrationPackageValidationError";
    this.code = code;
    this.field = field;
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PACKAGE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const ENTITY_ID_MAX_LENGTH = 128;
const PROJECT_NAME_MAX_LENGTH = 160;
const FILE_NAME_MAX_LENGTH = 255;
const MIME_TYPE_MAX_LENGTH = 120;
const SOURCE_PLATFORMS = new Set<MigrationPackageSourcePlatform>([
  "web",
  "electron",
  "cloud",
]);
const ASSET_KINDS = new Set<MigrationAssetKind>([
  "upload",
  "generated",
  "edit",
  "crop",
  "thumbnail",
  "preview",
  "video",
]);
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const FORBIDDEN_FIELD_NAMES = new Set([
  "apikey",
  "authorization",
  "objectkey",
  "signedurl",
  "uploadurl",
  "downloadurl",
  "providerurl",
  "targeturl",
  "baseurl",
  "endpointurl",
  "accesskey",
  "secretaccesskey",
  "credentials",
  "providerresponse",
  "fullresponse",
  "leasetoken",
  "workspaceid",
  "userid",
]);
const URL_SCHEME_PATTERN = /^(?:https?:|data:|blob:)/i;

function fail(
  code: MigrationPackageValidationCode,
  field: string,
  message: string,
): never {
  throw new MigrationPackageValidationError(code, field, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  code: MigrationPackageValidationCode,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    return fail(code, field, `${field} must be an object`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  code: MigrationPackageValidationCode,
  field: string,
) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(
        code,
        `${field}.${key}`,
        `${field} contains an unsupported field: ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      fail(
        code,
        `${field}.${key}`,
        `${field} is missing required field: ${key}`,
      );
    }
  }
}

function requireString(
  value: unknown,
  maxLength: number,
  code: MigrationPackageValidationCode,
  field: string,
) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    value.trim() !== value ||
    !isWellFormedUnicode(value)
  ) {
    return fail(
      code,
      field,
      `${field} must be a trimmed string between 1 and ${maxLength} characters`,
    );
  }
  return value;
}

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function requirePortableFileName(
  value: unknown,
  code: MigrationPackageValidationCode,
  field: string,
) {
  const fileName = requireString(value, FILE_NAME_MAX_LENGTH, code, field);
  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0") ||
    fileName === "." ||
    fileName === ".."
  ) {
    return fail(
      "INVALID_PATH",
      field,
      `${field} must be a file name, not a path`,
    );
  }
  return fileName;
}

function optionalString(
  value: unknown,
  maxLength: number,
  code: MigrationPackageValidationCode,
  field: string,
) {
  if (value === undefined || value === null) {
    return value as undefined | null;
  }
  return requireString(value, maxLength, code, field);
}

function requireSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code: MigrationPackageValidationCode,
  field: string,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    return fail(
      code,
      field,
      `${field} must be a safe integer between ${minimum} and ${maximum}`,
    );
  }
  return Number(value);
}

function requireFiniteNumber(
  value: unknown,
  code: MigrationPackageValidationCode,
  field: string,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(code, field, `${field} must be a finite number`);
  }
  return value;
}

function requirePortableId(
  value: unknown,
  code: MigrationPackageValidationCode,
  field: string,
) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    return fail(code, field, `${field} must be a portable opaque ID`);
  }
  return value;
}

function requireSha256(
  value: unknown,
  code: MigrationPackageValidationCode,
  field: string,
) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    return fail(code, field, `${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireIsoUtc(
  value: unknown,
  code: MigrationPackageValidationCode,
  field: string,
) {
  if (typeof value !== "string") {
    return fail(code, field, `${field} must be an ISO UTC timestamp`);
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    return fail(
      code,
      field,
      `${field} must use canonical ISO UTC milliseconds`,
    );
  }
  return value;
}

function mergeLimits(
  overrides?: Partial<MigrationPackageLimits>,
): MigrationPackageLimits {
  const limits = { ...defaultMigrationPackageLimits, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      fail(
        "PACKAGE_LIMIT_EXCEEDED",
        `limits.${key}`,
        `limits.${key} must be a positive safe integer`,
      );
    }
  }
  return limits;
}

function normalizedSensitiveFieldName(value: string) {
  return value.replace(/[-_]/g, "").toLowerCase();
}

function containsForbiddenUrl(value: unknown): boolean {
  if (typeof value === "string") {
    return URL_SCHEME_PATTERN.test(value.trim());
  }
  if (Array.isArray(value)) {
    return value.some(containsForbiddenUrl);
  }
  return false;
}

function validateJsonTree(
  value: unknown,
  field: string,
  limits: MigrationPackageLimits,
  state: { entries: number; seen: Set<object> },
  depth = 0,
): asserts value is MigrationJsonValue {
  if (depth > limits.maxJsonDepth) {
    fail(
      "PACKAGE_LIMIT_EXCEEDED",
      field,
      `${field} exceeds the JSON depth limit`,
    );
  }
  state.entries += 1;
  if (state.entries > limits.maxJsonEntries) {
    fail(
      "PACKAGE_LIMIT_EXCEEDED",
      field,
      "Package JSON contains too many values",
    );
  }
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) {
      fail(
        "NON_CANONICAL",
        field,
        `${field} contains an invalid UTF-16 surrogate`,
      );
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("NON_CANONICAL", field, `${field} contains a non-finite number`);
    }
    return;
  }
  if (typeof value !== "object") {
    fail("NON_CANONICAL", field, `${field} contains a non-JSON value`);
  }
  if (state.seen.has(value)) {
    fail("NON_CANONICAL", field, `${field} contains a cycle`);
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJsonTree(item, `${field}[${index}]`, limits, state, depth + 1),
    );
    state.seen.delete(value);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizedSensitiveFieldName(key);
    if (FORBIDDEN_FIELD_NAMES.has(normalizedKey)) {
      fail(
        "SENSITIVE_FIELD",
        `${field}.${key}`,
        `${field} contains forbidden internal or credential field: ${key}`,
      );
    }
    if (
      (normalizedKey.endsWith("url") || normalizedKey.endsWith("urls")) &&
      containsForbiddenUrl(item)
    ) {
      fail(
        "SENSITIVE_FIELD",
        `${field}.${key}`,
        `${field} contains a persistent external, data, or blob URL`,
      );
    }
    validateJsonTree(item, `${field}.${key}`, limits, state, depth + 1);
  }
  state.seen.delete(value);
}

export function canonicalJsonStringify(value: MigrationJsonValue): string {
  const serialize = (item: MigrationJsonValue): string => {
    if (item === null || typeof item !== "object") {
      if (typeof item === "number" && !Number.isFinite(item)) {
        fail(
          "NON_CANONICAL",
          "json",
          "Canonical JSON cannot contain non-finite numbers",
        );
      }
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) {
      return `[${item.map(serialize).join(",")}]`;
    }
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(item[key]!)}`)
      .join(",")}}`;
  };
  validateJsonTree(value, "json", mergeLimits(), {
    entries: 0,
    seen: new Set(),
  });
  return serialize(value);
}

export function parseCanonicalJson(text: string): MigrationJsonValue {
  if (text.startsWith("\uFEFF")) {
    fail(
      "NON_CANONICAL",
      "json",
      "Canonical JSON must not contain a byte-order mark",
    );
  }
  if (hasDuplicateJsonObjectKeys(text)) {
    fail(
      "NON_CANONICAL",
      "json",
      "Canonical JSON must not contain duplicate object keys",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("NON_CANONICAL", "json", "Canonical JSON is not valid JSON");
  }
  validateJsonTree(value, "json", mergeLimits(), {
    entries: 0,
    seen: new Set(),
  });
  const canonical = canonicalJsonStringify(value);
  if (text !== canonical) {
    fail(
      "NON_CANONICAL",
      "json",
      "JSON must use canonical key ordering and no insignificant whitespace",
    );
  }
  return value;
}

export function utf8ByteLength(value: string) {
  if (!isWellFormedUnicode(value)) {
    fail(
      "NON_CANONICAL",
      "utf8",
      "UTF-8 text cannot contain an unpaired surrogate",
    );
  }
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

export function validateMigrationPackagePath(
  value: unknown,
  limitOverrides?: Partial<MigrationPackageLimits>,
) {
  const limits = mergeLimits(limitOverrides);
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > limits.maxPathLength ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    /^[a-z]:/i.test(value) ||
    /%(?:2e|2f|5c)/i.test(value) ||
    !PACKAGE_PATH_PATTERN.test(value)
  ) {
    return fail(
      "INVALID_PATH",
      "path",
      "Package paths must be canonical relative ASCII paths",
    );
  }
  const segments = value.split("/");
  if (
    segments.length > limits.maxDirectoryDepth ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.length > limits.maxPathSegmentLength,
    )
  ) {
    return fail(
      "INVALID_PATH",
      "path",
      "Package path exceeds depth limits or contains an unsafe segment",
    );
  }
  return value;
}

function requireSortedUnique(
  values: readonly string[],
  code: MigrationPackageValidationCode,
  field: string,
) {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    if (previous === current) {
      fail(
        code,
        `${field}[${index}]`,
        `${field} contains a duplicate value: ${current}`,
      );
    }
    if (previous.localeCompare(current) > 0) {
      fail("NON_CANONICAL", field, `${field} must use stable ascending order`);
    }
  }
}

export function validateMigrationArchiveEntries(
  input: readonly MigrationPackageArchiveEntry[],
  limitOverrides?: Partial<MigrationPackageLimits>,
) {
  const limits = mergeLimits(limitOverrides);
  if (!Array.isArray(input)) {
    return fail(
      "INVALID_MANIFEST",
      "archiveEntries",
      "archiveEntries must be an array",
    );
  }
  const normalized: MigrationPackageArchiveEntry[] = [];
  const portablePaths = new Set<string>();
  let fileCount = 0;
  let totalUncompressed = 0;
  let totalCompressed = 0;

  for (const [index, rawEntry] of input.entries()) {
    const entry = assertRecord(
      rawEntry,
      "INVALID_MANIFEST",
      `archiveEntries[${index}]`,
    );
    assertExactKeys(
      entry,
      ["path", "kind", "uncompressedSize", "compressedSize"],
      ["sha256"],
      "INVALID_MANIFEST",
      `archiveEntries[${index}]`,
    );
    if (entry.kind === "symlink") {
      fail(
        "SYMLINK_NOT_ALLOWED",
        `archiveEntries[${index}]`,
        "Symbolic links are not allowed in migration packages",
      );
    }
    if (entry.kind !== "file" && entry.kind !== "directory") {
      fail(
        "INVALID_MANIFEST",
        `archiveEntries[${index}].kind`,
        "Archive entry kind is not supported",
      );
    }
    const rawPath = requireString(
      entry.path,
      limits.maxPathLength + 1,
      "INVALID_PATH",
      `archiveEntries[${index}].path`,
    );
    const path = validateMigrationPackagePath(
      entry.kind === "directory" && rawPath.endsWith("/")
        ? rawPath.slice(0, -1)
        : rawPath,
      limits,
    );
    const portablePath = path.toLowerCase();
    if (portablePaths.has(portablePath)) {
      fail(
        "DUPLICATE_PATH",
        `archiveEntries[${index}].path`,
        `Archive contains duplicate path: ${path}`,
      );
    }
    portablePaths.add(portablePath);
    const uncompressedSize = requireSafeInteger(
      entry.uncompressedSize,
      0,
      limits.maxFileUncompressedBytes,
      "PACKAGE_LIMIT_EXCEEDED",
      `archiveEntries[${index}].uncompressedSize`,
    );
    const compressedSize = requireSafeInteger(
      entry.compressedSize,
      0,
      limits.maxFileUncompressedBytes,
      "PACKAGE_LIMIT_EXCEEDED",
      `archiveEntries[${index}].compressedSize`,
    );
    if (
      entry.kind === "directory" &&
      (uncompressedSize !== 0 || compressedSize !== 0)
    ) {
      fail(
        "INVALID_MANIFEST",
        `archiveEntries[${index}]`,
        "Directory entries must have zero sizes",
      );
    }
    if (entry.kind === "file") {
      fileCount += 1;
      totalUncompressed += uncompressedSize;
      totalCompressed += compressedSize;
      if (
        uncompressedSize / Math.max(1, compressedSize) >
        limits.maxCompressionRatio
      ) {
        fail(
          "COMPRESSION_LIMIT_EXCEEDED",
          `archiveEntries[${index}]`,
          `Archive entry exceeds compression ratio limit: ${path}`,
        );
      }
    }
    normalized.push({
      path,
      kind: entry.kind,
      uncompressedSize,
      compressedSize,
      ...(entry.sha256 === undefined
        ? {}
        : {
            sha256: requireSha256(
              entry.sha256,
              "INVALID_MANIFEST",
              `archiveEntries[${index}].sha256`,
            ),
          }),
    });
  }

  if (
    fileCount > limits.maxFileCount ||
    totalUncompressed > limits.maxTotalUncompressedBytes
  ) {
    fail(
      "PACKAGE_LIMIT_EXCEEDED",
      "archiveEntries",
      "Migration package exceeds file count or uncompressed size limits",
    );
  }
  if (
    totalUncompressed / Math.max(1, totalCompressed) >
    limits.maxTotalCompressionRatio
  ) {
    fail(
      "COMPRESSION_LIMIT_EXCEEDED",
      "archiveEntries",
      "Migration package exceeds total compression ratio limit",
    );
  }
  requireSortedUnique(
    normalized.map((entry) => entry.path),
    "DUPLICATE_PATH",
    "archiveEntries",
  );
  return normalized;
}

export function validateMigrationPackageManifest(
  input: unknown,
  limitOverrides?: Partial<MigrationPackageLimits>,
): MigrationPackageManifest {
  const limits = mergeLimits(limitOverrides);
  const value = assertRecord(input, "INVALID_MANIFEST", "manifest");
  assertExactKeys(
    value,
    [
      "packageSchemaVersion",
      "packageId",
      "sourcePlatform",
      "exportedAt",
      "project",
      "fileCount",
      "totalByteSize",
      "contentSha256",
      "files",
    ],
    [],
    "INVALID_MANIFEST",
    "manifest",
  );
  if (value.packageSchemaVersion !== MIGRATION_PACKAGE_SCHEMA_VERSION) {
    fail(
      "UNKNOWN_SCHEMA",
      "manifest.packageSchemaVersion",
      "Unsupported migration package schema version",
    );
  }
  if (
    !SOURCE_PLATFORMS.has(
      value.sourcePlatform as MigrationPackageSourcePlatform,
    )
  ) {
    fail(
      "INVALID_MANIFEST",
      "manifest.sourcePlatform",
      "Unsupported migration package source platform",
    );
  }
  const project = assertRecord(
    value.project,
    "INVALID_MANIFEST",
    "manifest.project",
  );
  assertExactKeys(
    project,
    ["id", "version", "sequence"],
    [],
    "INVALID_MANIFEST",
    "manifest.project",
  );
  if (!Array.isArray(value.files)) {
    fail(
      "INVALID_MANIFEST",
      "manifest.files",
      "manifest.files must be an array",
    );
  }
  if (value.files.length < 3 || value.files.length > limits.maxFileCount - 1) {
    fail(
      "PACKAGE_LIMIT_EXCEEDED",
      "manifest.files",
      "manifest.files exceeds package limits",
    );
  }
  const files = value.files.map(
    (rawFile, index): MigrationPackageFileDescriptor => {
      const file = assertRecord(
        rawFile,
        "INVALID_MANIFEST",
        `manifest.files[${index}]`,
      );
      assertExactKeys(
        file,
        ["path", "byteSize", "sha256"],
        [],
        "INVALID_MANIFEST",
        `manifest.files[${index}]`,
      );
      const path = validateMigrationPackagePath(file.path, limits);
      if (path === migrationPackagePaths.manifest) {
        fail(
          "INVALID_MANIFEST",
          `manifest.files[${index}].path`,
          "manifest.json must not describe itself",
        );
      }
      return {
        path,
        byteSize: requireSafeInteger(
          file.byteSize,
          0,
          limits.maxFileUncompressedBytes,
          "PACKAGE_LIMIT_EXCEEDED",
          `manifest.files[${index}].byteSize`,
        ),
        sha256: requireSha256(
          file.sha256,
          "INVALID_MANIFEST",
          `manifest.files[${index}].sha256`,
        ),
      };
    },
  );
  requireSortedUnique(
    files.map((file) => file.path),
    "DUPLICATE_PATH",
    "manifest.files",
  );
  const totalByteSize = files.reduce((total, file) => total + file.byteSize, 0);
  if (totalByteSize > limits.maxTotalUncompressedBytes) {
    fail(
      "PACKAGE_LIMIT_EXCEEDED",
      "manifest.totalByteSize",
      "Manifest payload exceeds uncompressed size limit",
    );
  }
  if (
    value.fileCount !== files.length ||
    value.totalByteSize !== totalByteSize
  ) {
    fail(
      "INVALID_MANIFEST",
      "manifest",
      "Manifest fileCount or totalByteSize does not match files",
    );
  }
  for (const requiredPath of [
    migrationPackagePaths.project,
    migrationPackagePaths.graph,
    migrationPackagePaths.assets,
  ]) {
    if (!files.some((file) => file.path === requiredPath)) {
      fail(
        "INVALID_MANIFEST",
        "manifest.files",
        `Manifest is missing required file: ${requiredPath}`,
      );
    }
  }
  return {
    packageSchemaVersion: MIGRATION_PACKAGE_SCHEMA_VERSION,
    packageId: requirePortableId(
      value.packageId,
      "INVALID_MANIFEST",
      "manifest.packageId",
    ),
    sourcePlatform: value.sourcePlatform as MigrationPackageSourcePlatform,
    exportedAt: requireIsoUtc(
      value.exportedAt,
      "INVALID_MANIFEST",
      "manifest.exportedAt",
    ),
    project: {
      id: requirePortableId(
        project.id,
        "INVALID_MANIFEST",
        "manifest.project.id",
      ),
      version: requireSafeInteger(
        project.version,
        0,
        Number.MAX_SAFE_INTEGER,
        "INVALID_MANIFEST",
        "manifest.project.version",
      ),
      sequence: requireSafeInteger(
        project.sequence,
        0,
        Number.MAX_SAFE_INTEGER,
        "INVALID_MANIFEST",
        "manifest.project.sequence",
      ),
    },
    fileCount: files.length,
    totalByteSize,
    contentSha256: requireSha256(
      value.contentSha256,
      "INVALID_MANIFEST",
      "manifest.contentSha256",
    ),
    files,
  };
}

function validateSnapshotNodeOrEdgeArray(
  value: unknown,
  kind: "nodes" | "edges",
  field: string,
  limits: MigrationPackageLimits,
) {
  if (!Array.isArray(value)) {
    return fail("INVALID_PROJECT_RECORD", field, `${field} must be an array`);
  }
  const items = value.map((item, index) => {
    const record = assertRecord(
      item,
      "INVALID_PROJECT_RECORD",
      `${field}[${index}]`,
    );
    validateJsonTree(record, `${field}[${index}]`, limits, {
      entries: 0,
      seen: new Set(),
    });
    requireString(
      record.id,
      ENTITY_ID_MAX_LENGTH,
      "INVALID_PROJECT_RECORD",
      `${field}[${index}].id`,
    );
    if (kind === "edges") {
      requireString(
        record.source,
        ENTITY_ID_MAX_LENGTH,
        "INVALID_PROJECT_RECORD",
        `${field}[${index}].source`,
      );
      requireString(
        record.target,
        ENTITY_ID_MAX_LENGTH,
        "INVALID_PROJECT_RECORD",
        `${field}[${index}].target`,
      );
    }
    return record as MigrationJsonObject;
  });
  requireSortedUnique(
    items.map((item) => item.id as string),
    "INVALID_PROJECT_RECORD",
    field,
  );
  return items;
}

function validateMigrationProjectSnapshot(
  input: unknown,
  field: string,
  limits: MigrationPackageLimits,
): MigrationProjectSnapshot {
  const value = assertRecord(input, "INVALID_PROJECT_RECORD", field);
  assertExactKeys(
    value,
    ["schemaVersion", "canvas", "taskQueue"],
    [],
    "INVALID_PROJECT_RECORD",
    field,
  );
  if (value.schemaVersion !== MIGRATION_PROJECT_RECORD_SCHEMA_VERSION) {
    fail(
      "UNKNOWN_SCHEMA",
      `${field}.schemaVersion`,
      "Unsupported ProjectRecord snapshot schema version",
    );
  }
  const canvas = assertRecord(
    value.canvas,
    "INVALID_PROJECT_RECORD",
    `${field}.canvas`,
  );
  assertExactKeys(
    canvas,
    ["nodes", "edges"],
    [],
    "INVALID_PROJECT_RECORD",
    `${field}.canvas`,
  );
  const nodes = validateSnapshotNodeOrEdgeArray(
    canvas.nodes,
    "nodes",
    `${field}.canvas.nodes`,
    limits,
  );
  const edges = validateSnapshotNodeOrEdgeArray(
    canvas.edges,
    "edges",
    `${field}.canvas.edges`,
    limits,
  );
  const nodeIds = new Set(nodes.map((node) => node.id as string));
  for (const [index, edge] of edges.entries()) {
    if (
      !nodeIds.has(edge.source as string) ||
      !nodeIds.has(edge.target as string)
    ) {
      fail(
        "INVALID_PROJECT_RECORD",
        `${field}.canvas.edges[${index}]`,
        "ProjectRecord edge references a missing node",
      );
    }
  }
  const taskQueue = assertRecord(
    value.taskQueue,
    "INVALID_PROJECT_RECORD",
    `${field}.taskQueue`,
  );
  assertExactKeys(
    taskQueue,
    ["tasks"],
    [],
    "INVALID_PROJECT_RECORD",
    `${field}.taskQueue`,
  );
  if (!Array.isArray(taskQueue.tasks)) {
    fail(
      "INVALID_PROJECT_RECORD",
      `${field}.taskQueue.tasks`,
      "ProjectRecord tasks must be an array",
    );
  }
  const tasks = taskQueue.tasks.map((task, index) => {
    const record = assertRecord(
      task,
      "INVALID_PROJECT_RECORD",
      `${field}.taskQueue.tasks[${index}]`,
    );
    validateJsonTree(record, `${field}.taskQueue.tasks[${index}]`, limits, {
      entries: 0,
      seen: new Set(),
    });
    return record as MigrationJsonObject;
  });
  const taskIds = tasks.map((task) =>
    typeof task.id === "string" ? task.id : null,
  );
  if (taskIds.every((taskId): taskId is string => taskId !== null)) {
    requireSortedUnique(
      taskIds,
      "INVALID_PROJECT_RECORD",
      `${field}.taskQueue.tasks`,
    );
  }
  return {
    schemaVersion: MIGRATION_PROJECT_RECORD_SCHEMA_VERSION,
    canvas: { nodes, edges },
    taskQueue: { tasks },
  };
}

export function validateMigrationProjectRecord(
  input: unknown,
  limitOverrides?: Partial<MigrationPackageLimits>,
): MigrationProjectRecord {
  const limits = mergeLimits(limitOverrides);
  const value = assertRecord(input, "INVALID_PROJECT_RECORD", "projectRecord");
  assertExactKeys(
    value,
    [
      "id",
      "name",
      "savedSnapshot",
      "workingSnapshot",
      "createdAt",
      "updatedAt",
      "lastOpenedAt",
      "archivedAt",
    ],
    [],
    "INVALID_PROJECT_RECORD",
    "projectRecord",
  );
  return {
    id: requirePortableId(
      value.id,
      "INVALID_PROJECT_RECORD",
      "projectRecord.id",
    ),
    name: requireString(
      value.name,
      PROJECT_NAME_MAX_LENGTH,
      "INVALID_PROJECT_RECORD",
      "projectRecord.name",
    ),
    savedSnapshot: validateMigrationProjectSnapshot(
      value.savedSnapshot,
      "projectRecord.savedSnapshot",
      limits,
    ),
    workingSnapshot: validateMigrationProjectSnapshot(
      value.workingSnapshot,
      "projectRecord.workingSnapshot",
      limits,
    ),
    createdAt: requireIsoUtc(
      value.createdAt,
      "INVALID_PROJECT_RECORD",
      "projectRecord.createdAt",
    ),
    updatedAt: requireIsoUtc(
      value.updatedAt,
      "INVALID_PROJECT_RECORD",
      "projectRecord.updatedAt",
    ),
    lastOpenedAt: requireIsoUtc(
      value.lastOpenedAt,
      "INVALID_PROJECT_RECORD",
      "projectRecord.lastOpenedAt",
    ),
    archivedAt:
      value.archivedAt === null
        ? null
        : requireIsoUtc(
            value.archivedAt,
            "INVALID_PROJECT_RECORD",
            "projectRecord.archivedAt",
          ),
  };
}

function validateGraphNode(
  input: unknown,
  field: string,
  code: "INVALID_GRAPH" | "INVALID_CHECKPOINT",
  limits: MigrationPackageLimits,
): MigrationProjectGraphNode {
  const value = assertRecord(input, code, field);
  assertExactKeys(
    value,
    ["id", "nodeType", "position", "dataSchemaVersion", "data"],
    ["size", "zIndex", "parentNodeId", "presentation"],
    code,
    field,
  );
  const position = assertRecord(value.position, code, `${field}.position`);
  assertExactKeys(position, ["x", "y"], [], code, `${field}.position`);
  const data = assertRecord(value.data, code, `${field}.data`);
  validateJsonTree(data, `${field}.data`, limits, {
    entries: 0,
    seen: new Set(),
  });
  let size: { width: number; height: number } | undefined;
  if (value.size !== undefined) {
    const rawSize = assertRecord(value.size, code, `${field}.size`);
    assertExactKeys(rawSize, ["width", "height"], [], code, `${field}.size`);
    const width = requireFiniteNumber(
      rawSize.width,
      code,
      `${field}.size.width`,
    );
    const height = requireFiniteNumber(
      rawSize.height,
      code,
      `${field}.size.height`,
    );
    if (width <= 0 || height <= 0) {
      fail(code, `${field}.size`, "Node size must be positive");
    }
    size = { width, height };
  }
  let presentation: MigrationJsonObject | undefined;
  if (value.presentation !== undefined) {
    presentation = assertRecord(
      value.presentation,
      code,
      `${field}.presentation`,
    ) as MigrationJsonObject;
    validateJsonTree(presentation, `${field}.presentation`, limits, {
      entries: 0,
      seen: new Set(),
    });
  }
  let zIndex: number | undefined;
  if (value.zIndex !== undefined) {
    zIndex = requireSafeInteger(
      value.zIndex,
      -2_147_483_648,
      2_147_483_647,
      code,
      `${field}.zIndex`,
    );
  }
  return {
    id: requireString(value.id, ENTITY_ID_MAX_LENGTH, code, `${field}.id`),
    nodeType: requireString(
      value.nodeType,
      ENTITY_ID_MAX_LENGTH,
      code,
      `${field}.nodeType`,
    ),
    position: {
      x: requireFiniteNumber(position.x, code, `${field}.position.x`),
      y: requireFiniteNumber(position.y, code, `${field}.position.y`),
    },
    ...(size ? { size } : {}),
    ...(zIndex === undefined ? {} : { zIndex }),
    ...(value.parentNodeId === undefined
      ? {}
      : {
          parentNodeId: optionalString(
            value.parentNodeId,
            ENTITY_ID_MAX_LENGTH,
            code,
            `${field}.parentNodeId`,
          ),
        }),
    dataSchemaVersion: requireSafeInteger(
      value.dataSchemaVersion,
      1,
      Number.MAX_SAFE_INTEGER,
      code,
      `${field}.dataSchemaVersion`,
    ),
    data: data as MigrationJsonObject,
    ...(presentation ? { presentation } : {}),
  };
}

function validateGraphEdge(
  input: unknown,
  field: string,
  code: "INVALID_GRAPH" | "INVALID_CHECKPOINT",
  limits: MigrationPackageLimits,
): MigrationProjectGraphEdge {
  const value = assertRecord(input, code, field);
  assertExactKeys(
    value,
    ["id", "source", "target"],
    ["sourceHandle", "targetHandle", "edgeType", "data"],
    code,
    field,
  );
  let data: MigrationJsonObject | undefined;
  if (value.data !== undefined) {
    data = assertRecord(
      value.data,
      code,
      `${field}.data`,
    ) as MigrationJsonObject;
    validateJsonTree(data, `${field}.data`, limits, {
      entries: 0,
      seen: new Set(),
    });
  }
  return {
    id: requireString(value.id, ENTITY_ID_MAX_LENGTH, code, `${field}.id`),
    source: requireString(
      value.source,
      ENTITY_ID_MAX_LENGTH,
      code,
      `${field}.source`,
    ),
    target: requireString(
      value.target,
      ENTITY_ID_MAX_LENGTH,
      code,
      `${field}.target`,
    ),
    ...(value.sourceHandle === undefined
      ? {}
      : {
          sourceHandle: optionalString(
            value.sourceHandle,
            ENTITY_ID_MAX_LENGTH,
            code,
            `${field}.sourceHandle`,
          ),
        }),
    ...(value.targetHandle === undefined
      ? {}
      : {
          targetHandle: optionalString(
            value.targetHandle,
            ENTITY_ID_MAX_LENGTH,
            code,
            `${field}.targetHandle`,
          ),
        }),
    ...(value.edgeType === undefined
      ? {}
      : {
          edgeType: optionalString(
            value.edgeType,
            ENTITY_ID_MAX_LENGTH,
            code,
            `${field}.edgeType`,
          ),
        }),
    ...(data ? { data } : {}),
  };
}

function validateGraphTopology(
  nodes: MigrationProjectGraphNode[],
  edges: MigrationProjectGraphEdge[],
  field: string,
  code: "INVALID_GRAPH" | "INVALID_CHECKPOINT",
) {
  requireSortedUnique(
    nodes.map((node) => node.id),
    code,
    `${field}.nodes`,
  );
  requireSortedUnique(
    edges.map((edge) => edge.id),
    code,
    `${field}.edges`,
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const parents = new Map(
    nodes.map((node) => [node.id, node.parentNodeId ?? null]),
  );
  for (const node of nodes) {
    if (node.parentNodeId && !nodeIds.has(node.parentNodeId)) {
      fail(
        code,
        `${field}.nodes`,
        `Node ${node.id} references a missing parent`,
      );
    }
    const seen = new Set<string>();
    let current: string | null = node.id;
    while (current) {
      if (seen.has(current)) {
        fail(code, `${field}.nodes`, `Node parent cycle includes ${current}`);
      }
      seen.add(current);
      current = parents.get(current) ?? null;
    }
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      fail(code, `${field}.edges`, `Edge ${edge.id} references a missing node`);
    }
  }
}

export function validateMigrationProjectGraph(
  input: unknown,
  limitOverrides?: Partial<MigrationPackageLimits>,
): MigrationProjectGraph {
  const limits = mergeLimits(limitOverrides);
  const value = assertRecord(input, "INVALID_GRAPH", "graph");
  assertExactKeys(
    value,
    ["schemaVersion", "projectId", "version", "sequence", "nodes", "edges"],
    [],
    "INVALID_GRAPH",
    "graph",
  );
  if (value.schemaVersion !== MIGRATION_GRAPH_SCHEMA_VERSION) {
    fail(
      "UNKNOWN_SCHEMA",
      "graph.schemaVersion",
      "Unsupported migration graph schema version",
    );
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    fail("INVALID_GRAPH", "graph", "Graph nodes and edges must be arrays");
  }
  const nodes = value.nodes.map((node, index) =>
    validateGraphNode(node, `graph.nodes[${index}]`, "INVALID_GRAPH", limits),
  );
  const edges = value.edges.map((edge, index) =>
    validateGraphEdge(edge, `graph.edges[${index}]`, "INVALID_GRAPH", limits),
  );
  validateGraphTopology(nodes, edges, "graph", "INVALID_GRAPH");
  return {
    schemaVersion: MIGRATION_GRAPH_SCHEMA_VERSION,
    projectId: requirePortableId(
      value.projectId,
      "INVALID_GRAPH",
      "graph.projectId",
    ),
    version: requireSafeInteger(
      value.version,
      0,
      Number.MAX_SAFE_INTEGER,
      "INVALID_GRAPH",
      "graph.version",
    ),
    sequence: requireSafeInteger(
      value.sequence,
      0,
      Number.MAX_SAFE_INTEGER,
      "INVALID_GRAPH",
      "graph.sequence",
    ),
    nodes,
    edges,
  };
}

export function validateMigrationAssetManifest(
  input: unknown,
  limitOverrides?: Partial<MigrationPackageLimits>,
): MigrationAssetManifest {
  const limits = mergeLimits(limitOverrides);
  const value = assertRecord(input, "INVALID_ASSET_MANIFEST", "assetManifest");
  assertExactKeys(
    value,
    ["schemaVersion", "assets"],
    [],
    "INVALID_ASSET_MANIFEST",
    "assetManifest",
  );
  if (value.schemaVersion !== MIGRATION_ASSET_MANIFEST_SCHEMA_VERSION) {
    fail(
      "UNKNOWN_SCHEMA",
      "assetManifest.schemaVersion",
      "Unsupported migration asset manifest schema version",
    );
  }
  if (
    !Array.isArray(value.assets) ||
    value.assets.length > limits.maxFileCount - 3
  ) {
    fail(
      "PACKAGE_LIMIT_EXCEEDED",
      "assetManifest.assets",
      "Asset manifest exceeds package limits",
    );
  }
  const assets = value.assets.map((rawAsset, index): MigrationPackageAsset => {
    const field = `assetManifest.assets[${index}]`;
    const asset = assertRecord(rawAsset, "INVALID_ASSET_MANIFEST", field);
    assertExactKeys(
      asset,
      [
        "logicalAssetId",
        "filePath",
        "originalFileName",
        "mimeType",
        "byteSize",
        "sha256",
        "width",
        "height",
        "assetKind",
      ],
      [],
      "INVALID_ASSET_MANIFEST",
      field,
    );
    const logicalAssetId = requirePortableId(
      asset.logicalAssetId,
      "INVALID_ASSET_MANIFEST",
      `${field}.logicalAssetId`,
    );
    const filePath = validateMigrationPackagePath(asset.filePath, limits);
    if (
      !filePath.startsWith(
        `${migrationPackagePaths.assetRoot}/${logicalAssetId}.`,
      )
    ) {
      fail(
        "INVALID_ASSET_MANIFEST",
        `${field}.filePath`,
        "Asset file path must be derived from its logical asset ID",
      );
    }
    const mimeType = requireString(
      asset.mimeType,
      MIME_TYPE_MAX_LENGTH,
      "INVALID_ASSET_MANIFEST",
      `${field}.mimeType`,
    ).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      fail(
        "INVALID_ASSET_MANIFEST",
        `${field}.mimeType`,
        "Asset MIME type is not allowed",
      );
    }
    if (!ASSET_KINDS.has(asset.assetKind as MigrationAssetKind)) {
      fail(
        "INVALID_ASSET_MANIFEST",
        `${field}.assetKind`,
        "Asset kind is not allowed",
      );
    }
    const width =
      asset.width === null
        ? null
        : requireSafeInteger(
            asset.width,
            1,
            1_000_000,
            "INVALID_ASSET_MANIFEST",
            `${field}.width`,
          );
    const height =
      asset.height === null
        ? null
        : requireSafeInteger(
            asset.height,
            1,
            1_000_000,
            "INVALID_ASSET_MANIFEST",
            `${field}.height`,
          );
    if ((width === null) !== (height === null)) {
      fail(
        "INVALID_ASSET_MANIFEST",
        field,
        "Asset width and height must both be set or both be null",
      );
    }
    return {
      logicalAssetId,
      filePath,
      originalFileName:
        asset.originalFileName === null
          ? null
          : requirePortableFileName(
              asset.originalFileName,
              "INVALID_ASSET_MANIFEST",
              `${field}.originalFileName`,
            ),
      mimeType,
      byteSize: requireSafeInteger(
        asset.byteSize,
        1,
        limits.maxFileUncompressedBytes,
        "PACKAGE_LIMIT_EXCEEDED",
        `${field}.byteSize`,
      ),
      sha256: requireSha256(
        asset.sha256,
        "INVALID_ASSET_MANIFEST",
        `${field}.sha256`,
      ),
      width,
      height,
      assetKind: asset.assetKind as MigrationAssetKind,
    };
  });
  requireSortedUnique(
    assets.map((asset) => asset.logicalAssetId),
    "DUPLICATE_LOGICAL_ASSET_ID",
    "assetManifest.assets",
  );
  requireSortedUnique(
    [...assets]
      .sort((left, right) => left.filePath.localeCompare(right.filePath))
      .map((asset) => asset.filePath),
    "DUPLICATE_PATH",
    "assetManifest.assetPaths",
  );
  return { schemaVersion: MIGRATION_ASSET_MANIFEST_SCHEMA_VERSION, assets };
}

function validateCheckpointRecord(
  input: unknown,
  limits: MigrationPackageLimits,
): MigrationCheckpointRecord {
  const value = assertRecord(input, "INVALID_CHECKPOINT", "checkpoint.record");
  assertExactKeys(
    value,
    ["schemaVersion", "project", "canvas", "taskQueue"],
    [],
    "INVALID_CHECKPOINT",
    "checkpoint.record",
  );
  if (value.schemaVersion !== MIGRATION_PROJECT_RECORD_SCHEMA_VERSION) {
    fail(
      "UNKNOWN_SCHEMA",
      "checkpoint.record.schemaVersion",
      "Unsupported checkpoint record schema version",
    );
  }
  const project = assertRecord(
    value.project,
    "INVALID_CHECKPOINT",
    "checkpoint.record.project",
  );
  assertExactKeys(
    project,
    ["id", "name", "version", "lastSequence"],
    [],
    "INVALID_CHECKPOINT",
    "checkpoint.record.project",
  );
  const canvas = assertRecord(
    value.canvas,
    "INVALID_CHECKPOINT",
    "checkpoint.record.canvas",
  );
  assertExactKeys(
    canvas,
    ["nodes", "edges"],
    [],
    "INVALID_CHECKPOINT",
    "checkpoint.record.canvas",
  );
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
    fail(
      "INVALID_CHECKPOINT",
      "checkpoint.record.canvas",
      "Checkpoint nodes and edges must be arrays",
    );
  }
  const nodes = canvas.nodes.map((node, index) =>
    validateGraphNode(
      node,
      `checkpoint.record.canvas.nodes[${index}]`,
      "INVALID_CHECKPOINT",
      limits,
    ),
  );
  const edges = canvas.edges.map((edge, index) =>
    validateGraphEdge(
      edge,
      `checkpoint.record.canvas.edges[${index}]`,
      "INVALID_CHECKPOINT",
      limits,
    ),
  );
  validateGraphTopology(
    nodes,
    edges,
    "checkpoint.record.canvas",
    "INVALID_CHECKPOINT",
  );
  const taskQueue = assertRecord(
    value.taskQueue,
    "INVALID_CHECKPOINT",
    "checkpoint.record.taskQueue",
  );
  assertExactKeys(
    taskQueue,
    ["tasks"],
    [],
    "INVALID_CHECKPOINT",
    "checkpoint.record.taskQueue",
  );
  if (!Array.isArray(taskQueue.tasks)) {
    fail(
      "INVALID_CHECKPOINT",
      "checkpoint.record.taskQueue.tasks",
      "Checkpoint tasks must be an array",
    );
  }
  const tasks = taskQueue.tasks.map((task, index) => {
    const record = assertRecord(
      task,
      "INVALID_CHECKPOINT",
      `checkpoint.record.taskQueue.tasks[${index}]`,
    );
    validateJsonTree(
      record,
      `checkpoint.record.taskQueue.tasks[${index}]`,
      limits,
      { entries: 0, seen: new Set() },
    );
    return record as MigrationJsonObject;
  });
  return {
    schemaVersion: MIGRATION_PROJECT_RECORD_SCHEMA_VERSION,
    project: {
      id: requirePortableId(
        project.id,
        "INVALID_CHECKPOINT",
        "checkpoint.record.project.id",
      ),
      name: requireString(
        project.name,
        PROJECT_NAME_MAX_LENGTH,
        "INVALID_CHECKPOINT",
        "checkpoint.record.project.name",
      ),
      version: requireSafeInteger(
        project.version,
        0,
        Number.MAX_SAFE_INTEGER,
        "INVALID_CHECKPOINT",
        "checkpoint.record.project.version",
      ),
      lastSequence: requireSafeInteger(
        project.lastSequence,
        0,
        Number.MAX_SAFE_INTEGER,
        "INVALID_CHECKPOINT",
        "checkpoint.record.project.lastSequence",
      ),
    },
    canvas: { nodes, edges },
    taskQueue: { tasks },
  };
}

export function validateMigrationCheckpoint(
  input: unknown,
  limitOverrides?: Partial<MigrationPackageLimits>,
): MigrationPackageCheckpoint {
  const limits = mergeLimits(limitOverrides);
  const value = assertRecord(input, "INVALID_CHECKPOINT", "checkpoint");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "id",
      "projectId",
      "projectVersion",
      "sequence",
      "checkpointType",
      "createdAt",
      "assetIds",
      "record",
    ],
    [],
    "INVALID_CHECKPOINT",
    "checkpoint",
  );
  if (value.schemaVersion !== MIGRATION_CHECKPOINT_SCHEMA_VERSION) {
    fail(
      "UNKNOWN_SCHEMA",
      "checkpoint.schemaVersion",
      "Unsupported migration checkpoint schema version",
    );
  }
  if (
    !["manual", "periodic", "import", "pre_restore"].includes(
      String(value.checkpointType),
    )
  ) {
    fail(
      "INVALID_CHECKPOINT",
      "checkpoint.checkpointType",
      "Checkpoint type is not supported",
    );
  }
  if (!Array.isArray(value.assetIds)) {
    fail(
      "INVALID_CHECKPOINT",
      "checkpoint.assetIds",
      "checkpoint.assetIds must be an array",
    );
  }
  const assetIds = value.assetIds.map((assetId, index) =>
    requirePortableId(
      assetId,
      "INVALID_CHECKPOINT",
      `checkpoint.assetIds[${index}]`,
    ),
  );
  requireSortedUnique(assetIds, "INVALID_CHECKPOINT", "checkpoint.assetIds");
  return {
    schemaVersion: MIGRATION_CHECKPOINT_SCHEMA_VERSION,
    id: requirePortableId(value.id, "INVALID_CHECKPOINT", "checkpoint.id"),
    projectId: requirePortableId(
      value.projectId,
      "INVALID_CHECKPOINT",
      "checkpoint.projectId",
    ),
    projectVersion: requireSafeInteger(
      value.projectVersion,
      0,
      Number.MAX_SAFE_INTEGER,
      "INVALID_CHECKPOINT",
      "checkpoint.projectVersion",
    ),
    sequence: requireSafeInteger(
      value.sequence,
      0,
      Number.MAX_SAFE_INTEGER,
      "INVALID_CHECKPOINT",
      "checkpoint.sequence",
    ),
    checkpointType:
      value.checkpointType as MigrationPackageCheckpoint["checkpointType"],
    createdAt: requireIsoUtc(
      value.createdAt,
      "INVALID_CHECKPOINT",
      "checkpoint.createdAt",
    ),
    assetIds,
    record: validateCheckpointRecord(value.record, limits),
  };
}

function collectPortableAssetReferences(
  value: unknown,
  assetsByPath: ReadonlyMap<string, string>,
  field: string,
) {
  const assetIds = new Set<string>();
  const seen = new Set<object>();
  const visit = (item: unknown, path: string) => {
    if (!item || typeof item !== "object" || seen.has(item)) {
      return;
    }
    seen.add(item);
    if (Array.isArray(item)) {
      item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    const record = item as Record<string, unknown>;
    let explicitAssetId: string | null = null;
    if (
      "assetId" in record &&
      record.assetId !== null &&
      record.assetId !== undefined
    ) {
      explicitAssetId = requirePortableId(
        record.assetId,
        "REFERENCE_MISSING",
        `${path}.assetId`,
      );
      assetIds.add(explicitAssetId);
    }
    for (const key of [
      "relativePath",
      "thumbnailRelativePath",
      "previewRelativePath",
    ]) {
      const relativePath = record[key];
      if (
        relativePath === undefined ||
        relativePath === null ||
        relativePath === ""
      ) {
        continue;
      }
      const canonicalPath = validateMigrationPackagePath(relativePath);
      const pathAssetId = assetsByPath.get(canonicalPath);
      if (!pathAssetId) {
        fail(
          "REFERENCE_MISSING",
          `${path}.${key}`,
          `Asset path is not declared in assets.json: ${canonicalPath}`,
        );
      }
      if (
        key === "relativePath" &&
        explicitAssetId &&
        explicitAssetId !== pathAssetId
      ) {
        fail(
          "REFERENCE_MISSING",
          path,
          "assetId and relativePath refer to different logical assets",
        );
      }
      assetIds.add(pathAssetId);
    }
    for (const [key, entry] of Object.entries(record)) {
      if (
        key !== "assetId" &&
        key !== "relativePath" &&
        key !== "thumbnailRelativePath" &&
        key !== "previewRelativePath"
      ) {
        visit(entry, `${path}.${key}`);
      }
    }
  };
  visit(value, field);
  return assetIds;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

export function createMigrationPackageContentDigestInput(
  files: readonly MigrationPackageFileDescriptor[],
) {
  return canonicalJsonStringify(
    files.map((file) => ({
      byteSize: file.byteSize,
      path: file.path,
      sha256: file.sha256,
    })) as MigrationJsonValue,
  );
}

export function validateMigrationPackageContract(
  input: MigrationPackageContractInput,
): ValidatedMigrationPackageContract {
  const limits = mergeLimits(input.limits);
  const manifest = validateMigrationPackageManifest(input.manifest, limits);
  const projectRecord = validateMigrationProjectRecord(
    input.projectRecord,
    limits,
  );
  const graph = validateMigrationProjectGraph(input.graph, limits);
  const assetManifest = validateMigrationAssetManifest(
    input.assetManifest,
    limits,
  );
  const checkpoint =
    input.checkpoint === undefined || input.checkpoint === null
      ? null
      : validateMigrationCheckpoint(input.checkpoint, limits);
  const archiveEntries = validateMigrationArchiveEntries(
    input.archiveEntries,
    limits,
  );

  if (
    manifest.project.id !== projectRecord.id ||
    manifest.project.id !== graph.projectId
  ) {
    fail(
      "INVALID_MANIFEST",
      "manifest.project.id",
      "Manifest, ProjectRecord, and graph project IDs must match",
    );
  }
  if (
    manifest.project.version !== graph.version ||
    manifest.project.sequence !== graph.sequence
  ) {
    fail(
      "INVALID_MANIFEST",
      "manifest.project",
      "Manifest project version and sequence must match graph.json",
    );
  }
  if (checkpoint) {
    if (
      checkpoint.projectId !== manifest.project.id ||
      checkpoint.record.project.id !== manifest.project.id ||
      checkpoint.projectVersion !== checkpoint.record.project.version ||
      checkpoint.sequence !== checkpoint.record.project.lastSequence
    ) {
      fail(
        "INVALID_CHECKPOINT",
        "checkpoint",
        "Checkpoint project identity, version, or sequence is inconsistent",
      );
    }
  }

  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const expectedPaths = new Set([
    migrationPackagePaths.project,
    migrationPackagePaths.graph,
    migrationPackagePaths.assets,
    ...assetManifest.assets.map((asset) => asset.filePath),
    ...(checkpoint ? [migrationPackagePaths.checkpoint] : []),
  ]);
  if (
    filesByPath.size !== expectedPaths.size ||
    [...filesByPath.keys()].some((path) => !expectedPaths.has(path))
  ) {
    fail(
      "INVALID_MANIFEST",
      "manifest.files",
      "Manifest must contain exactly the single-project contract files and declared assets",
    );
  }
  const hasCheckpointDescriptor = filesByPath.has(
    migrationPackagePaths.checkpoint,
  );
  if (hasCheckpointDescriptor !== Boolean(checkpoint)) {
    fail(
      "INVALID_CHECKPOINT",
      "checkpoint",
      "checkpoint.json descriptor and checkpoint payload must appear together",
    );
  }
  for (const asset of assetManifest.assets) {
    const descriptor = filesByPath.get(asset.filePath);
    if (
      !descriptor ||
      descriptor.byteSize !== asset.byteSize ||
      descriptor.sha256 !== asset.sha256
    ) {
      fail(
        "INVALID_ASSET_MANIFEST",
        "assetManifest.assets",
        `Asset metadata does not match manifest descriptor: ${asset.logicalAssetId}`,
      );
    }
  }

  const fileEntries = archiveEntries.filter((entry) => entry.kind === "file");
  const entriesByPath = new Map(
    fileEntries.map((entry) => [entry.path, entry]),
  );
  const expectedArchivePaths = new Set([
    migrationPackagePaths.manifest,
    ...filesByPath.keys(),
  ]);
  if (
    entriesByPath.size !== expectedArchivePaths.size ||
    [...entriesByPath.keys()].some((path) => !expectedArchivePaths.has(path))
  ) {
    fail(
      "INVALID_MANIFEST",
      "archiveEntries",
      "Archive entries do not match manifest files",
    );
  }
  for (const descriptor of manifest.files) {
    const entry = entriesByPath.get(descriptor.path);
    if (
      !entry ||
      entry.uncompressedSize !== descriptor.byteSize ||
      (entry.sha256 !== undefined && entry.sha256 !== descriptor.sha256)
    ) {
      fail(
        "INVALID_MANIFEST",
        "archiveEntries",
        `Archive entry does not match manifest descriptor: ${descriptor.path}`,
      );
    }
  }

  const declaredAssetIds = new Set(
    assetManifest.assets.map((asset) => asset.logicalAssetId),
  );
  const assetsByPath = new Map(
    assetManifest.assets.map((asset) => [asset.filePath, asset.logicalAssetId]),
  );
  const references = new Set([
    ...collectPortableAssetReferences(
      projectRecord,
      assetsByPath,
      "projectRecord",
    ),
    ...collectPortableAssetReferences(graph, assetsByPath, "graph"),
  ]);
  for (const assetId of references) {
    if (!declaredAssetIds.has(assetId)) {
      fail(
        "REFERENCE_MISSING",
        "assets",
        `Logical asset is referenced but not declared: ${assetId}`,
      );
    }
  }
  if (checkpoint) {
    const checkpointReferences = collectPortableAssetReferences(
      checkpoint.record,
      assetsByPath,
      "checkpoint.record",
    );
    if (!setsEqual(checkpointReferences, new Set(checkpoint.assetIds))) {
      fail(
        "INVALID_CHECKPOINT",
        "checkpoint.assetIds",
        "Checkpoint asset IDs must match checkpoint record references",
      );
    }
    for (const assetId of checkpoint.assetIds) {
      if (!declaredAssetIds.has(assetId)) {
        fail(
          "REFERENCE_MISSING",
          "checkpoint.assetIds",
          `Checkpoint references an undeclared logical asset: ${assetId}`,
        );
      }
    }
  }

  return {
    manifest,
    projectRecord,
    graph,
    assetManifest,
    checkpoint,
    archiveEntries,
  };
}

export function validatePrepareMigrationImportRequest(
  input: unknown,
): PrepareMigrationImportRequest {
  const value = assertRecord(input, "INVALID_MANIFEST", "prepareImport");
  assertExactKeys(
    value,
    [
      "idempotencyKey",
      "manifest",
      "projectRecord",
      "graph",
      "assetManifest",
      "archiveEntries",
    ],
    ["checkpoint"],
    "INVALID_MANIFEST",
    "prepareImport",
  );
  const validated = validateMigrationPackageContract({
    manifest: value.manifest,
    projectRecord: value.projectRecord,
    graph: value.graph,
    assetManifest: value.assetManifest,
    checkpoint: value.checkpoint,
    archiveEntries: value.archiveEntries as MigrationPackageArchiveEntry[],
  });
  return {
    idempotencyKey: requireString(
      value.idempotencyKey,
      200,
      "INVALID_MANIFEST",
      "prepareImport.idempotencyKey",
    ),
    manifest: validated.manifest,
    projectRecord: validated.projectRecord,
    graph: validated.graph,
    assetManifest: validated.assetManifest,
    checkpoint: validated.checkpoint,
    archiveEntries: validated.archiveEntries,
  };
}

export function validateCompleteMigrationImportAssetUploadRequest(
  input: unknown,
): CompleteMigrationImportAssetUploadRequest {
  if (input === undefined || input === null) {
    return {};
  }
  const value = assertRecord(
    input,
    "INVALID_MANIFEST",
    "completeMigrationAssetUpload",
  );
  assertExactKeys(
    value,
    [],
    ["parts"],
    "INVALID_MANIFEST",
    "completeMigrationAssetUpload",
  );
  if (value.parts === undefined) {
    return {};
  }
  const parts = assertRecord(
    value.parts,
    "INVALID_MANIFEST",
    "completeMigrationAssetUpload.parts",
  );
  const normalized: Record<string, CompleteMigrationImportAssetPartRequest> =
    {};
  for (const [partNumber, rawPart] of Object.entries(parts)) {
    if (!/^[1-9][0-9]{0,4}$/.test(partNumber)) {
      fail(
        "INVALID_MANIFEST",
        `completeMigrationAssetUpload.parts.${partNumber}`,
        "Part number is invalid",
      );
    }
    const part = assertRecord(
      rawPart,
      "INVALID_MANIFEST",
      `completeMigrationAssetUpload.parts.${partNumber}`,
    );
    assertExactKeys(
      part,
      ["etag", "byteSize"],
      [],
      "INVALID_MANIFEST",
      `completeMigrationAssetUpload.parts.${partNumber}`,
    );
    const etag = requireString(
      part.etag,
      256,
      "INVALID_MANIFEST",
      `completeMigrationAssetUpload.parts.${partNumber}.etag`,
    );
    if (etag.length < 1 || /[\r\n]/.test(etag)) {
      fail(
        "INVALID_MANIFEST",
        `completeMigrationAssetUpload.parts.${partNumber}.etag`,
        "Part ETag is invalid",
      );
    }
    normalized[partNumber] = {
      etag,
      byteSize: requireSafeInteger(
        part.byteSize,
        1,
        Number.MAX_SAFE_INTEGER,
        "INVALID_MANIFEST",
        `completeMigrationAssetUpload.parts.${partNumber}.byteSize`,
      ),
    };
  }
  return { parts: normalized };
}

export function validateCommitMigrationImportRequest(
  input: unknown,
): CommitMigrationImportRequest {
  const value = assertRecord(
    input,
    "INVALID_MANIFEST",
    "commitMigrationImport",
  );
  assertExactKeys(
    value,
    ["idempotencyKey", "strategy"],
    ["expectedVersion", "expectedSequence", "confirmReplace"],
    "INVALID_MANIFEST",
    "commitMigrationImport",
  );
  if (value.strategy !== "copy" && value.strategy !== "replace") {
    fail(
      "INVALID_MANIFEST",
      "commitMigrationImport.strategy",
      "Commit strategy must be copy or replace",
    );
  }
  const expectedVersion =
    value.expectedVersion === undefined
      ? undefined
      : requireSafeInteger(
          value.expectedVersion,
          0,
          Number.MAX_SAFE_INTEGER,
          "INVALID_MANIFEST",
          "commitMigrationImport.expectedVersion",
        );
  const expectedSequence =
    value.expectedSequence === undefined
      ? undefined
      : requireSafeInteger(
          value.expectedSequence,
          0,
          Number.MAX_SAFE_INTEGER,
          "INVALID_MANIFEST",
          "commitMigrationImport.expectedSequence",
        );
  const confirmReplace =
    value.confirmReplace === undefined ? undefined : value.confirmReplace;
  if (confirmReplace !== undefined && typeof confirmReplace !== "boolean") {
    fail(
      "INVALID_MANIFEST",
      "commitMigrationImport.confirmReplace",
      "confirmReplace must be a boolean",
    );
  }
  return {
    idempotencyKey: requireString(
      value.idempotencyKey,
      200,
      "INVALID_MANIFEST",
      "commitMigrationImport.idempotencyKey",
    ),
    strategy: value.strategy,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(expectedSequence === undefined ? {} : { expectedSequence }),
    ...(confirmReplace === undefined ? {} : { confirmReplace }),
  };
}
