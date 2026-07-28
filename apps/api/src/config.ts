import {
  readOptionalEnv,
  readPortEnv,
  readRequiredEnv,
  readPositiveIntegerEnv,
  validateProtectedDeploymentEnvironment,
  type LogLevel,
} from "@ai-canvas-cloud/shared";

export interface ApiConfig {
  env: string;
  logLevel: LogLevel;
  host: string;
  port: number;
  trustProxy: boolean;
  shutdownTimeoutMs: number;
  staticSiteRoot?: string;
  betterAuthUrl: string;
  betterAuthSecret: string;
  webPublicUrl: string;
  webAllowedOrigins: string[];
  databaseUrl: string;
  redisUrl: string;
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
  devSeedAdmin: boolean;
  devSeedAdminUsername: string;
  devSeedAdminEmail: string;
  devSeedAdminPassword?: string;
  authEmailTransport: "development" | "smtp" | "managed";
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure: boolean;
  smtpFrom?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpCredentialKeys?: string;
  smtpCredentialActiveKeyVersion: number;
}

const logLevels = new Set<LogLevel>(["debug", "info", "warn", "error"]);
const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const value = readOptionalEnv(env, "LOG_LEVEL", "info");

  if (!logLevels.has(value as LogLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${value}`);
  }

  return value as LogLevel;
}

function readBooleanEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
) {
  const value = env[key];

  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return truthyEnvValues.has(value.trim().toLowerCase());
}

function readAllowedOrigins(env: NodeJS.ProcessEnv, fallback: string) {
  const raw = env.WEB_ALLOWED_ORIGINS?.trim() || fallback;
  const origins = [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (origins.length === 0) {
    throw new Error("WEB_ALLOWED_ORIGINS must contain at least one origin");
  }
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid WEB_ALLOWED_ORIGINS origin: ${origin}`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`Invalid WEB_ALLOWED_ORIGINS origin: ${origin}`);
    }
    if (parsed.pathname !== "/") {
      throw new Error(
        `WEB_ALLOWED_ORIGINS must contain origins without paths: ${origin}`,
      );
    }
  }
  return origins.map((origin) => new URL(origin).origin);
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const appEnv = readOptionalEnv(env, "NODE_ENV", "development");
  validateProtectedDeploymentEnvironment(env);
  const authEmailTransport = readOptionalEnv(
    env,
    "AUTH_EMAIL_TRANSPORT",
    "development",
  ).toLowerCase();
  if (
    authEmailTransport !== "development" &&
    authEmailTransport !== "smtp" &&
    authEmailTransport !== "managed"
  ) {
    throw new Error(`Invalid AUTH_EMAIL_TRANSPORT: ${authEmailTransport}`);
  }
  const smtpCredentialActiveKeyVersion = Number(
    env.SMTP_CREDENTIAL_ACTIVE_KEY_VERSION ?? 1,
  );
  if (
    !Number.isInteger(smtpCredentialActiveKeyVersion) ||
    smtpCredentialActiveKeyVersion < 1
  ) {
    throw new Error("SMTP_CREDENTIAL_ACTIVE_KEY_VERSION must be positive");
  }
  const objectStorageCredentialActiveKeyVersion = Number(
    env.OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION ?? 1,
  );
  if (
    !Number.isInteger(objectStorageCredentialActiveKeyVersion) ||
    objectStorageCredentialActiveKeyVersion < 1
  ) {
    throw new Error(
      "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION must be positive",
    );
  }

  return {
    env: appEnv,
    logLevel: readLogLevel(env),
    host: readOptionalEnv(env, "API_HOST", "127.0.0.1"),
    port: readPortEnv(env, "API_PORT", 8787),
    trustProxy: readBooleanEnv(env, "API_TRUST_PROXY", false),
    shutdownTimeoutMs: readPositiveIntegerEnv(
      env,
      "API_SHUTDOWN_TIMEOUT_MS",
      10_000,
    ),
    staticSiteRoot: env.WEB_STATIC_SITE_ROOT?.trim() || undefined,
    betterAuthUrl: readOptionalEnv(
      env,
      "BETTER_AUTH_URL",
      `http://${readOptionalEnv(env, "API_HOST", "127.0.0.1")}:${readPortEnv(env, "API_PORT", 8787)}`,
    ),
    betterAuthSecret: readRequiredEnv(env, "BETTER_AUTH_SECRET"),
    webPublicUrl: readOptionalEnv(
      env,
      "WEB_PUBLIC_URL",
      "http://localhost:5173",
    ),
    webAllowedOrigins: readAllowedOrigins(
      env,
      readOptionalEnv(env, "WEB_PUBLIC_URL", "http://localhost:5173"),
    ),
    databaseUrl: readRequiredEnv(env, "DATABASE_URL"),
    redisUrl: readRequiredEnv(env, "REDIS_URL"),
    s3Endpoint: readRequiredEnv(env, "S3_ENDPOINT"),
    s3PublicEndpoint: readOptionalEnv(
      env,
      "S3_PUBLIC_ENDPOINT",
      readRequiredEnv(env, "S3_ENDPOINT"),
    ),
    s3PublicOrigin: readOptionalEnv(
      env,
      "S3_PUBLIC_ORIGIN",
      new URL(
        readOptionalEnv(
          env,
          "S3_PUBLIC_ENDPOINT",
          readRequiredEnv(env, "S3_ENDPOINT"),
        ),
      ).origin,
    ),
    s3ForcePathStyle: readBooleanEnv(env, "S3_FORCE_PATH_STYLE", true),
    s3Bucket: readRequiredEnv(env, "S3_BUCKET"),
    s3Region: readRequiredEnv(env, "S3_REGION"),
    s3AccessKeyId: readRequiredEnv(env, "S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: readRequiredEnv(env, "S3_SECRET_ACCESS_KEY"),
    objectStorageCredentialKeys:
      env.OBJECT_STORAGE_CREDENTIAL_KEYS?.trim() || undefined,
    objectStorageCredentialActiveKeyVersion,
    devSeedAdmin:
      appEnv !== "production" && readBooleanEnv(env, "DEV_SEED_ADMIN", false),
    devSeedAdminUsername: readOptionalEnv(
      env,
      "DEV_SEED_ADMIN_USERNAME",
      "admin_user",
    ),
    devSeedAdminEmail: readOptionalEnv(
      env,
      "DEV_SEED_ADMIN_EMAIL",
      "admin@example.com",
    ),
    devSeedAdminPassword: env.DEV_SEED_ADMIN_PASSWORD?.trim() || undefined,
    authEmailTransport,
    smtpHost: env.SMTP_HOST?.trim() || undefined,
    smtpPort: env.SMTP_PORT ? readPortEnv(env, "SMTP_PORT", 465) : undefined,
    smtpSecure: readBooleanEnv(env, "SMTP_SECURE", false),
    smtpFrom: env.SMTP_FROM?.trim() || undefined,
    smtpUsername: env.SMTP_USERNAME?.trim() || undefined,
    smtpPassword: env.SMTP_PASSWORD?.trim() || undefined,
    smtpCredentialKeys: env.SMTP_CREDENTIAL_KEYS?.trim() || undefined,
    smtpCredentialActiveKeyVersion,
  };
}
