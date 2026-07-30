import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const publicKeys = [
  "NODE_ENV",
  "DEPLOYMENT_ENV",
  "LOG_LEVEL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "WEB_PUBLIC_URL",
  "WEB_ALLOWED_ORIGINS",
  "DATABASE_URL",
  "REDIS_URL",
  "OBJECT_STORAGE_ENVIRONMENT_FALLBACK",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_PUBLIC_ORIGIN",
  "S3_FORCE_PATH_STYLE",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION",
  "OBJECT_STORAGE_CREDENTIAL_KEYS",
  "ASSET_MAINTENANCE_TOKEN",
  "AUTH_EMAIL_TRANSPORT",
  "SMTP_CREDENTIAL_ACTIVE_KEY_VERSION",
  "SMTP_CREDENTIAL_KEYS",
  "DEPLOYMENT_RESOURCE_NAMESPACE",
  "DEPLOYMENT_CREDENTIAL_NAMESPACE",
  "DATABASE_RESOURCE_ID",
  "REDIS_RESOURCE_ID",
  "S3_RESOURCE_ID",
  "MAIL_RESOURCE_ID",
  "PERSISTENCE_RESOURCE_ID",
  "DATABASE_CREDENTIAL_ID",
  "REDIS_CREDENTIAL_ID",
  "S3_CREDENTIAL_ID",
  "MAIL_CREDENTIAL_ID",
];

const adminKeys = [
  "NODE_ENV",
  "DEPLOYMENT_ENV",
  "LOG_LEVEL",
  "APP_DATABASE_ROLE",
  "ADMIN_DATABASE_URL",
  "ADMIN_BETTER_AUTH_URL",
  "ADMIN_BETTER_AUTH_SECRET",
  "ADMIN_WEB_PUBLIC_URL",
  "ADMIN_WEB_ALLOWED_ORIGINS",
  "WEB_ALLOWED_ORIGINS",
  "OBJECT_STORAGE_ENVIRONMENT_FALLBACK",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_PUBLIC_ORIGIN",
  "S3_FORCE_PATH_STYLE",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION",
  "OBJECT_STORAGE_CREDENTIAL_KEYS",
  "ASSET_MAINTENANCE_TOKEN",
  "SMTP_CREDENTIAL_ACTIVE_KEY_VERSION",
  "SMTP_CREDENTIAL_KEYS",
];

function fixtureValue(key) {
  const values = {
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "production",
    LOG_LEVEL: "info",
    BETTER_AUTH_URL: "https://canvas.example.com",
    BETTER_AUTH_SECRET: "public-auth-secret-value",
    WEB_PUBLIC_URL: "https://canvas.example.com",
    WEB_ALLOWED_ORIGINS: "https://canvas.example.com",
    DATABASE_URL:
      "postgresql://public-role:public-password@postgres:5432/cloud",
    REDIS_URL: "redis://:redis-password@redis:6379/0",
    OBJECT_STORAGE_ENVIRONMENT_FALLBACK: "false",
    S3_ENDPOINT: "https://oss.example.com",
    S3_PUBLIC_ENDPOINT: "https://oss.example.com",
    S3_PUBLIC_ORIGIN: "https://bucket.oss.example.com",
    S3_FORCE_PATH_STYLE: "false",
    S3_BUCKET: "cloud-production-assets",
    S3_REGION: "cn-example-1",
    S3_ACCESS_KEY_ID: "access-key",
    S3_SECRET_ACCESS_KEY: "access-secret",
    OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    OBJECT_STORAGE_CREDENTIAL_KEYS: '{"1":"storage-key"}',
    ASSET_MAINTENANCE_TOKEN: "asset-maintenance-token-for-tests-123456",
    AUTH_EMAIL_TRANSPORT: "managed",
    SMTP_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    SMTP_CREDENTIAL_KEYS: '{"1":"smtp-key"}',
    DEPLOYMENT_RESOURCE_NAMESPACE: "cloud-production",
    DEPLOYMENT_CREDENTIAL_NAMESPACE: "cloud-production-credentials",
    DATABASE_RESOURCE_ID: "cloud-production-postgres",
    REDIS_RESOURCE_ID: "cloud-production-redis",
    S3_RESOURCE_ID: "cloud-production-oss",
    MAIL_RESOURCE_ID: "cloud-production-mail",
    PERSISTENCE_RESOURCE_ID: "cloud-production-single-host",
    DATABASE_CREDENTIAL_ID: "cloud-production-postgres-credential",
    REDIS_CREDENTIAL_ID: "cloud-production-redis-credential",
    S3_CREDENTIAL_ID: "cloud-production-oss-credential",
    MAIL_CREDENTIAL_ID: "cloud-production-mail-credential",
    APP_DATABASE_ROLE: "public-role",
    ADMIN_DATABASE_URL:
      "postgresql://admin-role:admin-password@postgres:5432/cloud",
    ADMIN_BETTER_AUTH_URL: "https://admin.example.com",
    ADMIN_BETTER_AUTH_SECRET: "admin-auth-secret-value",
    ADMIN_WEB_PUBLIC_URL: "https://admin.example.com",
    ADMIN_WEB_ALLOWED_ORIGINS: "https://admin.example.com",
  };
  return values[key] ?? "";
}

test("single-host runtime rendering isolates public and admin credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-canvas-runtime-env-"));
  const runtimeDirectory = join(directory, "runtime");
  const source = join(directory, "release.env");
  const publicDestination = join(runtimeDirectory, "public.env");
  const adminDestination = join(runtimeDirectory, "admin.env");
  mkdirSync(runtimeDirectory);
  const keys = [...new Set([...publicKeys, ...adminKeys])];
  writeFileSync(
    source,
    [
      ...keys.map((key) => `${key}=${fixtureValue(key)}`),
      "ADMIN_DATABASE_ROLE=admin-role",
      "PUBLIC_HTTP_ADAPTER=fastify",
      "ADMIN_HTTP_ADAPTER=legacy",
      "",
    ].join("\n"),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/render-single-host-runtime-env.mjs",
        "--source",
        source,
        "--public",
        publicDestination,
        "--admin",
        adminDestination,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);

    const publicRuntime = readFileSync(publicDestination, "utf8");
    const adminRuntime = readFileSync(adminDestination, "utf8");
    assert.match(
      publicRuntime,
      /^WEB_STATIC_SITE_ROOT=\/app\/apps\/web\/dist$/m,
    );
    assert.match(
      adminRuntime,
      /^ADMIN_STATIC_SITE_ROOT=\/app\/apps\/admin-web\/dist$/m,
    );
    assert.match(
      adminRuntime,
      /^ASSET_MAINTENANCE_API_URL=http:\/\/public:8080$/m,
    );
    assert.match(publicRuntime, /^HTTP_ADAPTER=fastify$/m);
    assert.match(adminRuntime, /^HTTP_ADAPTER=legacy$/m);
    assert.match(
      publicRuntime,
      /^ASSET_MAINTENANCE_TOKEN=asset-maintenance-token-for-tests-123456$/m,
    );
    assert.match(
      adminRuntime,
      /^ASSET_MAINTENANCE_TOKEN=asset-maintenance-token-for-tests-123456$/m,
    );
    assert.doesNotMatch(publicRuntime, /^ADMIN_DATABASE_URL=/m);
    assert.doesNotMatch(publicRuntime, /^ADMIN_BETTER_AUTH_SECRET=/m);
    assert.doesNotMatch(adminRuntime, /^DATABASE_URL=/m);
    assert.doesNotMatch(adminRuntime, /^BETTER_AUTH_SECRET=/m);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
