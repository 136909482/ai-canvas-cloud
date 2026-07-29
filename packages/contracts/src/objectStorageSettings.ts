export type ObjectStorageSettingsSource =
  "managed" | "environment" | "unconfigured";

declare const URL: {
  new (input: string): {
    protocol: string;
    username: string;
    password: string;
    pathname: string;
    search: string;
    hash: string;
    origin: string;
    hostname: string;
    toString(): string;
  };
};

export interface ObjectStorageSettingsResponse {
  source: ObjectStorageSettingsSource;
  endpoint: string;
  publicEndpoint: string;
  publicOrigin: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  credentialsConfigured: boolean;
  environmentFallbackConfigured: boolean;
  identityLocked: boolean;
  revisionId: string | null;
  updatedAt: string | null;
}

export interface ObjectStorageSettingsInput {
  endpoint: string;
  publicEndpoint: string;
  publicOrigin: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  expectedRevisionId: string | null;
}

export interface ObjectStorageTestResponse {
  ok: true;
  testedAt: string;
}

export interface RestoreEnvironmentObjectStorageInput {
  expectedRevisionId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Object storage settings must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const supported = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) throw new Error(`${key} is not supported`);
  }
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${field} length is invalid`);
  }
  return normalized;
}

function httpUrl(value: unknown, field: string) {
  const normalized = text(value, field, 8, 2048);
  let parsed: InstanceType<typeof URL>;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${field} is invalid`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${field} is invalid`);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

function origin(value: unknown) {
  const normalized = httpUrl(value, "publicOrigin");
  const parsed = new URL(normalized);
  if (parsed.pathname !== "/")
    throw new Error("publicOrigin must be an origin");
  return parsed.origin;
}

export function validateObjectStorageSettingsInput(
  value: unknown,
): ObjectStorageSettingsInput {
  const input = record(value);
  exactKeys(input, [
    "endpoint",
    "publicEndpoint",
    "publicOrigin",
    "region",
    "bucket",
    "forcePathStyle",
    "accessKeyId",
    "secretAccessKey",
    "expectedRevisionId",
  ]);
  const endpoint = httpUrl(input.endpoint, "endpoint");
  const publicEndpoint = httpUrl(input.publicEndpoint, "publicEndpoint");
  const publicOrigin = origin(input.publicOrigin);
  const region = text(input.region, "region", 1, 63).toLowerCase();
  const bucket = text(input.bucket, "bucket", 3, 63).toLowerCase();
  if (!REGION_PATTERN.test(region)) throw new Error("region is invalid");
  if (!BUCKET_PATTERN.test(bucket) || bucket.includes("..")) {
    throw new Error("bucket is invalid");
  }
  if (typeof input.forcePathStyle !== "boolean") {
    throw new Error("forcePathStyle must be a boolean");
  }
  const expectedPublicOrigin = new URL(publicEndpoint);
  if (!input.forcePathStyle) {
    expectedPublicOrigin.hostname = `${bucket}.${expectedPublicOrigin.hostname}`;
  }
  if (publicOrigin !== expectedPublicOrigin.origin) {
    throw new Error("publicOrigin does not match the bucket signing endpoint");
  }
  const expectedRevisionId = input.expectedRevisionId;
  if (
    expectedRevisionId !== null &&
    (typeof expectedRevisionId !== "string" ||
      !UUID_PATTERN.test(expectedRevisionId))
  ) {
    throw new Error("expectedRevisionId is invalid");
  }
  const hasAccessKeyId = input.accessKeyId !== undefined;
  const hasSecret = input.secretAccessKey !== undefined;
  if (hasAccessKeyId !== hasSecret) {
    throw new Error(
      "accessKeyId and secretAccessKey must be provided together",
    );
  }
  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;
  if (hasAccessKeyId) {
    accessKeyId = text(input.accessKeyId, "accessKeyId", 1, 256);
    secretAccessKey = text(input.secretAccessKey, "secretAccessKey", 1, 1024);
  }
  return {
    endpoint,
    publicEndpoint,
    publicOrigin,
    region,
    bucket,
    forcePathStyle: input.forcePathStyle,
    ...(accessKeyId ? { accessKeyId, secretAccessKey } : {}),
    expectedRevisionId,
  };
}

export function validateRestoreEnvironmentObjectStorageInput(
  value: unknown,
): RestoreEnvironmentObjectStorageInput {
  const input = record(value);
  exactKeys(input, ["expectedRevisionId"]);
  if (
    typeof input.expectedRevisionId !== "string" ||
    !UUID_PATTERN.test(input.expectedRevisionId)
  ) {
    throw new Error("expectedRevisionId is invalid");
  }
  return { expectedRevisionId: input.expectedRevisionId };
}
