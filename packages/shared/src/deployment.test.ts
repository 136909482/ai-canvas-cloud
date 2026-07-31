import assert from "node:assert/strict";
import test from "node:test";
import {
  databasePoolMax,
  validateProtectedDeploymentEnvironment,
} from "./deployment.ts";

function baseEnv() {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "staging",
    DEPLOYMENT_ENV: "staging",
    WEB_PUBLIC_URL: "https://canvas-staging.example.com",
    BETTER_AUTH_URL: "https://canvas-staging.example.com",
    WEB_ALLOWED_ORIGINS: "https://canvas-staging.example.com",
    DATABASE_URL:
      "postgres://staging-user:long-staging-password@staging-postgres:5432/ai_canvas_cloud_staging",
    REDIS_URL:
      "rediss://staging-user:long-staging-password@staging-redis:6379/0",
    S3_ENDPOINT: "https://staging-storage.example.com",
    S3_PUBLIC_ENDPOINT: "https://staging-storage.example.com",
    S3_PUBLIC_ORIGIN: "https://staging-storage.example.com",
    S3_BUCKET: "ai-canvas-cloud-staging-assets",
    BETTER_AUTH_SECRET: "a".repeat(48),
    S3_ACCESS_KEY_ID: "staging-access-key",
    S3_SECRET_ACCESS_KEY: "staging-object-secret",
    OBJECT_STORAGE_CREDENTIAL_KEYS: JSON.stringify({
      1: Buffer.alloc(32, 6).toString("base64"),
    }),
    OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    AUTH_EMAIL_TRANSPORT: "managed",
    SMTP_CREDENTIAL_KEYS: JSON.stringify({
      1: Buffer.alloc(32, 7).toString("base64"),
    }),
    SMTP_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    DEPLOYMENT_RESOURCE_NAMESPACE: "ai-canvas-cloud-staging",
    DEPLOYMENT_CREDENTIAL_NAMESPACE: "ai-canvas-cloud-staging-credentials",
  };
  for (const key of [
    "DATABASE_RESOURCE_ID",
    "REDIS_RESOURCE_ID",
    "S3_RESOURCE_ID",
    "MAIL_RESOURCE_ID",
    "PERSISTENCE_RESOURCE_ID",
    "DATABASE_CREDENTIAL_ID",
    "REDIS_CREDENTIAL_ID",
    "S3_CREDENTIAL_ID",
    "MAIL_CREDENTIAL_ID",
  ]) {
    env[key] = `ai-canvas-cloud-staging-${key.toLowerCase()}`;
  }
  return env;
}

test("protected deployment accepts independently scoped staging resources", () => {
  assert.doesNotThrow(() => validateProtectedDeploymentEnvironment(baseEnv()));
});

test("database connection budget is shared across public and Admin instances", () => {
  const env = {
    DATABASE_MAX_CONNECTIONS: "30",
    DATABASE_RESERVED_CONNECTIONS: "6",
    API_INSTANCE_COUNT: "2",
    ADMIN_API_INSTANCE_COUNT: "2",
  };
  assert.equal(databasePoolMax(env, "api"), 6);
  assert.equal(databasePoolMax(env, "admin-api"), 6);
  assert.throws(
    () =>
      databasePoolMax(
        {
          ...env,
          API_DATABASE_POOL_MAX: "7",
          ADMIN_DATABASE_POOL_MAX: "6",
        },
        "api",
      ),
    /budget exceeded/,
  );
  assert.throws(
    () => databasePoolMax({ ...env, API_DATABASE_POOL_MAX: "11" }, "api"),
    /must not exceed 10/,
  );
});

test("protected deployment accepts virtual-hosted object storage origins", () => {
  assert.doesNotThrow(() =>
    validateProtectedDeploymentEnvironment({
      ...baseEnv(),
      S3_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
      S3_PUBLIC_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
      S3_PUBLIC_ORIGIN:
        "https://ai-canvas-cloud-staging-assets.oss-cn-hangzhou.aliyuncs.com",
      S3_FORCE_PATH_STYLE: "false",
    }),
  );
});

test("protected deployment accepts managed SMTP", () => {
  const env = baseEnv();
  env.AUTH_EMAIL_TRANSPORT = "managed";
  env.SMTP_CREDENTIAL_KEYS = JSON.stringify({
    1: Buffer.alloc(32, 7).toString("base64"),
  });
  env.SMTP_CREDENTIAL_ACTIVE_KEY_VERSION = "1";
  assert.doesNotThrow(() => validateProtectedDeploymentEnvironment(env));
});

test("protected deployment can start before managed object storage is configured", () => {
  const env = baseEnv();
  env.OBJECT_STORAGE_ENVIRONMENT_FALLBACK = "false";
  for (const key of [
    "S3_ENDPOINT",
    "S3_PUBLIC_ENDPOINT",
    "S3_PUBLIC_ORIGIN",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ]) {
    delete env[key];
  }
  assert.doesNotThrow(() => validateProtectedDeploymentEnvironment(env));
});

test("protected deployment rejects local URLs, placeholders, missing origins and seed", () => {
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        WEB_PUBLIC_URL: "http://localhost:5173",
      }),
    /HTTPS|localhost/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        BETTER_AUTH_SECRET: "replace-with-a-long-random-secret",
      }),
    /placeholder/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        WEB_ALLOWED_ORIGINS: "",
      }),
    /WEB_ALLOWED_ORIGINS/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        DEV_SEED_ADMIN: "true",
      }),
    /seed/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        S3_SECRET_ACCESS_KEY: "minioadmin",
      }),
    /placeholder|default/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        S3_PUBLIC_ENDPOINT: "http://storage.example.com",
      }),
    /S3_PUBLIC_ENDPOINT|HTTPS/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        S3_PUBLIC_ENDPOINT: "https://localhost:9000",
      }),
    /S3_PUBLIC_ENDPOINT|localhost/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        S3_PUBLIC_ORIGIN: "https://other-storage.example.com",
      }),
    /S3_PUBLIC_ORIGIN/,
  );
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        S3_FORCE_PATH_STYLE: "sometimes",
      }),
    /S3_FORCE_PATH_STYLE/,
  );
});

test("protected deployment rejects identifiers shared with another environment", () => {
  assert.throws(
    () =>
      validateProtectedDeploymentEnvironment({
        ...baseEnv(),
        REDIS_RESOURCE_ID: "ai-canvas-cloud-production-redis",
      }),
    /staging|production environment/,
  );
});
