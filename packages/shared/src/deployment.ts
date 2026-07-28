const PROTECTED_ENVIRONMENTS = new Set(["staging", "production"]);
const RESOURCE_KEYS = [
  "DATABASE_RESOURCE_ID",
  "REDIS_RESOURCE_ID",
  "S3_RESOURCE_ID",
  "MAIL_RESOURCE_ID",
  "PERSISTENCE_RESOURCE_ID",
] as const;
const CREDENTIAL_KEYS = [
  "DATABASE_CREDENTIAL_ID",
  "REDIS_CREDENTIAL_ID",
  "S3_CREDENTIAL_ID",
  "MAIL_CREDENTIAL_ID",
] as const;

function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function truthy(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  key: string,
) {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${key} must be a boolean value`);
}

function rejectLocalHost(value: string, key: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error(
      `${key} must not use a localhost address in a protected environment`,
    );
  }
  return parsed;
}

function rejectPlaceholder(
  value: string,
  key: string,
  options?: { allowAngleBrackets?: boolean },
) {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("replace-with") ||
    normalized.includes("change-me") ||
    normalized.includes("changeme") ||
    (!options?.allowAngleBrackets && normalized.includes("<")) ||
    (options?.allowAngleBrackets &&
      normalized.includes("<") &&
      !normalized.includes("@")) ||
    normalized.includes("minioadmin")
  ) {
    throw new Error(
      `${key} must contain a deployment secret, not a placeholder or default credential`,
    );
  }
}

function requireEnvironmentScopedId(
  env: NodeJS.ProcessEnv,
  key: string,
  environment: string,
) {
  const value = required(env, key);
  const normalized = value.toLowerCase();
  if (!normalized.includes(environment)) {
    throw new Error(`${key} must be scoped to ${environment}`);
  }
  for (const other of [
    "local",
    "development",
    "test",
    "staging",
    "production",
  ]) {
    if (other !== environment && normalized.includes(other)) {
      throw new Error(`${key} must not reference the ${other} environment`);
    }
  }
  return value;
}

export function isProtectedDeploymentEnvironment(environment: string) {
  return PROTECTED_ENVIRONMENTS.has(environment);
}

export interface DeploymentValidationOptions {
  requireWeb?: boolean;
  requireMail?: boolean;
}

export function validateProtectedDeploymentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: DeploymentValidationOptions = {},
) {
  const environment = (env.NODE_ENV ?? "development").trim().toLowerCase();
  if (!isProtectedDeploymentEnvironment(environment)) {
    return;
  }
  if ((env.DEPLOYMENT_ENV ?? "").trim().toLowerCase() !== environment) {
    throw new Error(`DEPLOYMENT_ENV must equal NODE_ENV (${environment})`);
  }
  for (const key of [...RESOURCE_KEYS, ...CREDENTIAL_KEYS]) {
    requireEnvironmentScopedId(env, key, environment);
  }
  requireEnvironmentScopedId(env, "DEPLOYMENT_RESOURCE_NAMESPACE", environment);
  requireEnvironmentScopedId(
    env,
    "DEPLOYMENT_CREDENTIAL_NAMESPACE",
    environment,
  );
  const resourceIds = RESOURCE_KEYS.map((key) =>
    env[key]!.trim().toLowerCase(),
  );
  const credentialIds = CREDENTIAL_KEYS.map((key) =>
    env[key]!.trim().toLowerCase(),
  );
  if (
    new Set(resourceIds).size !== resourceIds.length ||
    new Set(credentialIds).size !== credentialIds.length
  ) {
    throw new Error(
      "Protected deployment resource and credential identifiers must be unique",
    );
  }

  const bucket = required(env, "S3_BUCKET").toLowerCase();
  if (!bucket.includes(environment)) {
    throw new Error(`S3_BUCKET must be scoped to ${environment}`);
  }
  const forcePathStyle = readBoolean(
    env.S3_FORCE_PATH_STYLE,
    true,
    "S3_FORCE_PATH_STYLE",
  );

  if (options.requireWeb !== false) {
    const webPublicUrl = rejectLocalHost(
      required(env, "WEB_PUBLIC_URL"),
      "WEB_PUBLIC_URL",
    );
    const authUrl = rejectLocalHost(
      required(env, "BETTER_AUTH_URL"),
      "BETTER_AUTH_URL",
    );
    if (webPublicUrl.protocol !== "https:" || authUrl.protocol !== "https:") {
      throw new Error(
        "WEB_PUBLIC_URL and BETTER_AUTH_URL must use HTTPS in a protected environment",
      );
    }
    if (!env.WEB_ALLOWED_ORIGINS?.trim()) {
      throw new Error(
        "WEB_ALLOWED_ORIGINS is required in a protected environment",
      );
    }
    const allowedOrigins = env.WEB_ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (
      allowedOrigins.length === 0 ||
      allowedOrigins.some((origin) => {
        const parsed = rejectLocalHost(origin, "WEB_ALLOWED_ORIGINS");
        return parsed.protocol !== "https:";
      })
    ) {
      throw new Error(
        "WEB_ALLOWED_ORIGINS must contain HTTPS origins in a protected environment",
      );
    }
    const publicStorage = rejectLocalHost(
      required(env, "S3_PUBLIC_ENDPOINT"),
      "S3_PUBLIC_ENDPOINT",
    );
    if (
      publicStorage.protocol !== "https:" ||
      publicStorage.search ||
      publicStorage.hash
    ) {
      throw new Error(
        "S3_PUBLIC_ENDPOINT must be an HTTPS origin without query or fragment in a protected environment",
      );
    }
    const publicStorageOrigin = rejectLocalHost(
      required(env, "S3_PUBLIC_ORIGIN"),
      "S3_PUBLIC_ORIGIN",
    );
    const expectedPublicOrigin = new URL(publicStorage.origin);
    if (!forcePathStyle) {
      expectedPublicOrigin.hostname = `${bucket}.${expectedPublicOrigin.hostname}`;
    }
    if (
      publicStorageOrigin.protocol !== "https:" ||
      publicStorageOrigin.origin !== expectedPublicOrigin.origin
    ) {
      throw new Error(
        forcePathStyle
          ? "S3_PUBLIC_ORIGIN must match the HTTPS origin of S3_PUBLIC_ENDPOINT"
          : "S3_PUBLIC_ORIGIN must match the bucket virtual-hosted HTTPS origin derived from S3_PUBLIC_ENDPOINT",
      );
    }
  }

  const databaseUrlKey = "DATABASE_URL";
  const databaseUrl = rejectLocalHost(
    required(env, databaseUrlKey),
    databaseUrlKey,
  );
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error(`${databaseUrlKey} must use PostgreSQL`);
  }
  const redisUrl = rejectLocalHost(required(env, "REDIS_URL"), "REDIS_URL");
  if (!["redis:", "rediss:"].includes(redisUrl.protocol)) {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  rejectLocalHost(required(env, "S3_ENDPOINT"), "S3_ENDPOINT");
  if (options.requireWeb !== false) {
    rejectPlaceholder(
      required(env, "BETTER_AUTH_SECRET"),
      "BETTER_AUTH_SECRET",
    );
    if (env.BETTER_AUTH_SECRET!.trim().length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
    }
  }
  rejectPlaceholder(required(env, "S3_ACCESS_KEY_ID"), "S3_ACCESS_KEY_ID");
  rejectPlaceholder(
    required(env, "S3_SECRET_ACCESS_KEY"),
    "S3_SECRET_ACCESS_KEY",
  );
  rejectPlaceholder(
    required(env, "OBJECT_STORAGE_CREDENTIAL_KEYS"),
    "OBJECT_STORAGE_CREDENTIAL_KEYS",
  );
  const objectStorageCredentialVersion = Number(
    required(env, "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION"),
  );
  if (
    !Number.isInteger(objectStorageCredentialVersion) ||
    objectStorageCredentialVersion < 1
  ) {
    throw new Error(
      "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION must be positive",
    );
  }
  if (
    truthy(env.DEV_SEED_ADMIN) ||
    env.DEV_SEED_ADMIN_EMAIL?.trim() ||
    env.DEV_SEED_ADMIN_PASSWORD?.trim()
  ) {
    throw new Error(
      "Development administrator seed must be disabled and unset in a protected environment",
    );
  }

  if (options.requireMail !== false) {
    const emailTransport = (env.AUTH_EMAIL_TRANSPORT ?? "")
      .trim()
      .toLowerCase();
    if (emailTransport !== "smtp" && emailTransport !== "managed") {
      throw new Error(
        "AUTH_EMAIL_TRANSPORT=smtp or managed is required in a protected environment",
      );
    }
    const requiredMailKeys =
      emailTransport === "managed"
        ? [
            "SMTP_CREDENTIAL_KEYS",
            "SMTP_CREDENTIAL_ACTIVE_KEY_VERSION",
            "MAIL_RESOURCE_ID",
            "MAIL_CREDENTIAL_ID",
          ]
        : [
            "SMTP_HOST",
            "SMTP_FROM",
            "SMTP_USERNAME",
            "SMTP_PASSWORD",
            "MAIL_RESOURCE_ID",
            "MAIL_CREDENTIAL_ID",
          ];
    for (const key of requiredMailKeys) {
      rejectPlaceholder(required(env, key), key, {
        allowAngleBrackets: key === "SMTP_FROM",
      });
    }
    if (emailTransport === "smtp") {
      const smtpPort = Number(required(env, "SMTP_PORT"));
      if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
        throw new Error("SMTP_PORT must be a valid port");
      }
      if (truthy(env.SMTP_SECURE) === false) {
        throw new Error("SMTP_SECURE must be true in a protected environment");
      }
    }
  }
}

export const deploymentEnvironmentResourceKeys = [
  ...RESOURCE_KEYS,
  ...CREDENTIAL_KEYS,
];
