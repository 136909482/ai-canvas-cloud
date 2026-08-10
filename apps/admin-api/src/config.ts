import {
  databasePoolMax,
  readOptionalEnv,
  readPortEnv,
  readPositiveIntegerEnv,
  readRequiredEnv,
  isProtectedDeploymentEnvironment,
  type LogLevel,
} from "@ai-canvas-cloud/shared";
import { isAbsolute } from "node:path";

export interface AdminApiConfig {
  env: string;
  host: string;
  port: number;
  logLevel: LogLevel;
  shutdownTimeoutMs: number;
  staticSiteRoot?: string;
  trustProxy: boolean;
  databaseUrl: string;
  databasePoolMax?: number;
  betterAuthUrl: string;
  betterAuthSecret: string;
  ordinaryAuthSecret: string;
  webPublicUrl: string;
  allowedOrigins: string[];
  objectStorageEnvironmentFallback: boolean;
  s3Endpoint: string;
  s3PublicEndpoint: string;
  s3PublicOrigin: string;
  s3ForcePathStyle: boolean;
  s3Bucket: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  objectStorageCredentialKeys?: string;
  objectStorageCredentialActiveKeyVersion: number;
  assetMaintenanceApiUrl: string;
  assetMaintenanceToken?: string;
  smtpCredentialKeys?: string;
  smtpCredentialActiveKeyVersion: number;
  smtpDevelopmentSecret?: string;
  systemUpdateDirectory?: string;
  systemUpdateRepository?: string;
  systemUpdateCurrentImage?: string;
}

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);
const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const value = env[key]?.trim().toLowerCase();
  return value ? TRUTHY_VALUES.has(value) : fallback;
}

function parseOrigins(raw: string) {
  const origins = [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (origins.length === 0)
    throw new Error(
      "ADMIN_WEB_ALLOWED_ORIGINS must contain at least one origin",
    );
  return origins.map((value) => {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(`Invalid ADMIN_WEB_ALLOWED_ORIGINS origin: ${value}`);
    }
    return url.origin;
  });
}

function databaseRole(url: string, key: string) {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    throw new Error(`${key} must be a valid PostgreSQL URL`);
  }
}

export function loadAdminApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): AdminApiConfig {
  const appEnv = readOptionalEnv(env, "NODE_ENV", "development");
  const host = readOptionalEnv(env, "ADMIN_API_HOST", "127.0.0.1");
  const port = readPortEnv(env, "ADMIN_API_PORT", 8788);
  const databaseUrl = readRequiredEnv(env, "ADMIN_DATABASE_URL");
  const ordinaryDatabaseRole = readRequiredEnv(env, "APP_DATABASE_ROLE");
  const betterAuthSecret = readRequiredEnv(env, "ADMIN_BETTER_AUTH_SECRET");
  const ordinaryAuthSecret = readRequiredEnv(env, "BETTER_AUTH_SECRET");
  const smtpCredentialKeys = env.SMTP_CREDENTIAL_KEYS?.trim() || undefined;
  const smtpCredentialActiveKeyVersion = Number(
    env.SMTP_CREDENTIAL_ACTIVE_KEY_VERSION ?? 1,
  );
  const objectStorageCredentialKeys =
    env.OBJECT_STORAGE_CREDENTIAL_KEYS?.trim() || undefined;
  const objectStorageCredentialActiveKeyVersion = Number(
    env.OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION ?? 1,
  );
  const objectStorageEnvironmentFallback = readBoolean(
    env,
    "OBJECT_STORAGE_ENVIRONMENT_FALLBACK",
    true,
  );
  const webPublicUrl = readOptionalEnv(
    env,
    "ADMIN_WEB_PUBLIC_URL",
    "http://localhost:5174",
  );
  const allowedOrigins = parseOrigins(
    readOptionalEnv(env, "ADMIN_WEB_ALLOWED_ORIGINS", webPublicUrl),
  );
  const assetMaintenanceApiUrl = readOptionalEnv(
    env,
    "ASSET_MAINTENANCE_API_URL",
    "http://127.0.0.1:8787",
  );
  const assetMaintenanceToken = env.ASSET_MAINTENANCE_TOKEN?.trim();
  const systemUpdateDirectory = env.SYSTEM_UPDATE_DIRECTORY?.trim();
  const systemUpdateRepository =
    env.SYSTEM_UPDATE_REPOSITORY?.trim().toLowerCase();
  const systemUpdateCurrentImage = env.SYSTEM_UPDATE_CURRENT_IMAGE?.trim();
  const systemUpdateValues = [
    systemUpdateDirectory,
    systemUpdateRepository,
    systemUpdateCurrentImage,
  ];
  if (systemUpdateValues.some(Boolean) && !systemUpdateValues.every(Boolean)) {
    throw new Error(
      "SYSTEM_UPDATE_DIRECTORY, SYSTEM_UPDATE_REPOSITORY, and SYSTEM_UPDATE_CURRENT_IMAGE must be configured together",
    );
  }
  if (systemUpdateDirectory && !isAbsolute(systemUpdateDirectory)) {
    throw new Error("SYSTEM_UPDATE_DIRECTORY must be an absolute path");
  }
  if (
    systemUpdateRepository &&
    !/^[a-z0-9](?:[a-z0-9._-]{0,126})\/[a-z0-9](?:[a-z0-9._-]{0,126})$/.test(
      systemUpdateRepository,
    )
  ) {
    throw new Error("SYSTEM_UPDATE_REPOSITORY must be a Docker Hub repository");
  }
  if (
    systemUpdateCurrentImage &&
    !new RegExp(
      `^${systemUpdateRepository?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@sha256:[a-f0-9]{64}$`,
    ).test(systemUpdateCurrentImage)
  ) {
    throw new Error(
      "SYSTEM_UPDATE_CURRENT_IMAGE must use the configured digest",
    );
  }
  let parsedMaintenanceUrl: URL;
  try {
    parsedMaintenanceUrl = new URL(assetMaintenanceApiUrl);
  } catch {
    throw new Error("ASSET_MAINTENANCE_API_URL must be a valid HTTP URL");
  }
  if (
    !["http:", "https:"].includes(parsedMaintenanceUrl.protocol) ||
    parsedMaintenanceUrl.username ||
    parsedMaintenanceUrl.password ||
    parsedMaintenanceUrl.pathname !== "/" ||
    parsedMaintenanceUrl.search ||
    parsedMaintenanceUrl.hash
  ) {
    throw new Error("ASSET_MAINTENANCE_API_URL must be an HTTP origin");
  }
  if (assetMaintenanceToken && assetMaintenanceToken.length < 32) {
    throw new Error("ASSET_MAINTENANCE_TOKEN must be at least 32 characters");
  }
  if (isProtectedDeploymentEnvironment(appEnv) && !assetMaintenanceToken) {
    throw new Error(
      "ASSET_MAINTENANCE_TOKEN is required in a protected environment",
    );
  }
  const logLevel = readOptionalEnv(env, "LOG_LEVEL", "info") as LogLevel;
  if (!LOG_LEVELS.has(logLevel))
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}`);
  if (
    betterAuthSecret.length < 32 ||
    ordinaryAuthSecret.length < 32 ||
    betterAuthSecret === ordinaryAuthSecret
  ) {
    throw new Error(
      "ADMIN_BETTER_AUTH_SECRET and BETTER_AUTH_SECRET must each be at least 32 characters and independent",
    );
  }
  if (
    databaseRole(databaseUrl, "ADMIN_DATABASE_URL") === ordinaryDatabaseRole
  ) {
    throw new Error(
      "ADMIN_DATABASE_URL must use a database role distinct from APP_DATABASE_ROLE",
    );
  }
  if (
    !Number.isInteger(objectStorageCredentialActiveKeyVersion) ||
    objectStorageCredentialActiveKeyVersion < 1
  ) {
    throw new Error(
      "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION must be positive",
    );
  }
  if (
    !Number.isInteger(smtpCredentialActiveKeyVersion) ||
    smtpCredentialActiveKeyVersion < 1
  ) {
    throw new Error("SMTP_CREDENTIAL_ACTIVE_KEY_VERSION must be positive");
  }
  if (isProtectedDeploymentEnvironment(appEnv) && !smtpCredentialKeys) {
    throw new Error(
      "SMTP_CREDENTIAL_KEYS is required in a protected environment",
    );
  }
  if (
    isProtectedDeploymentEnvironment(appEnv) &&
    !objectStorageCredentialKeys
  ) {
    throw new Error(
      "OBJECT_STORAGE_CREDENTIAL_KEYS is required in a protected environment",
    );
  }
  const ordinaryOrigins = (env.WEB_ALLOWED_ORIGINS ?? env.WEB_PUBLIC_URL ?? "")
    .split(",")
    .map((value) => value.trim());
  if (allowedOrigins.some((origin) => ordinaryOrigins.includes(origin))) {
    throw new Error("Admin Web and ordinary Web origins must be distinct");
  }
  const s3Endpoint = objectStorageEnvironmentFallback
    ? readRequiredEnv(env, "S3_ENDPOINT")
    : "";
  const s3PublicEndpoint = objectStorageEnvironmentFallback
    ? readOptionalEnv(env, "S3_PUBLIC_ENDPOINT", s3Endpoint)
    : "";
  return {
    env: appEnv,
    host,
    port,
    logLevel,
    shutdownTimeoutMs: readPositiveIntegerEnv(
      env,
      "ADMIN_API_SHUTDOWN_TIMEOUT_MS",
      10_000,
    ),
    staticSiteRoot: env.ADMIN_STATIC_SITE_ROOT?.trim() || undefined,
    trustProxy: readBoolean(env, "ADMIN_API_TRUST_PROXY", false),
    databaseUrl,
    databasePoolMax: databasePoolMax(env, "admin-api"),
    betterAuthUrl: readOptionalEnv(
      env,
      "ADMIN_BETTER_AUTH_URL",
      `http://${host}:${port}`,
    ),
    betterAuthSecret,
    ordinaryAuthSecret,
    webPublicUrl,
    allowedOrigins,
    objectStorageEnvironmentFallback,
    s3Endpoint,
    s3PublicEndpoint,
    s3PublicOrigin: objectStorageEnvironmentFallback
      ? readOptionalEnv(
          env,
          "S3_PUBLIC_ORIGIN",
          new URL(s3PublicEndpoint).origin,
        )
      : "",
    s3ForcePathStyle: readBoolean(env, "S3_FORCE_PATH_STYLE", true),
    s3Bucket: objectStorageEnvironmentFallback
      ? readRequiredEnv(env, "S3_BUCKET")
      : "",
    s3Region: objectStorageEnvironmentFallback
      ? readRequiredEnv(env, "S3_REGION")
      : "",
    s3AccessKeyId: objectStorageEnvironmentFallback
      ? readRequiredEnv(env, "S3_ACCESS_KEY_ID")
      : "",
    s3SecretAccessKey: objectStorageEnvironmentFallback
      ? readRequiredEnv(env, "S3_SECRET_ACCESS_KEY")
      : "",
    objectStorageCredentialKeys,
    objectStorageCredentialActiveKeyVersion,
    assetMaintenanceApiUrl: parsedMaintenanceUrl.origin,
    assetMaintenanceToken,
    smtpCredentialKeys,
    smtpCredentialActiveKeyVersion,
    smtpDevelopmentSecret:
      appEnv === "development" ? ordinaryAuthSecret : undefined,
    systemUpdateDirectory,
    systemUpdateRepository,
    systemUpdateCurrentImage,
  };
}
