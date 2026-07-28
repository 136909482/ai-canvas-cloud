import assert from "node:assert/strict";
import test from "node:test";
import { loadAdminApiConfig } from "./config.ts";

const baseEnv = {
  NODE_ENV: "development",
  APP_DATABASE_ROLE: "ordinary_role",
  BETTER_AUTH_SECRET: "ordinary-auth-secret-that-is-long-enough",
  WEB_ALLOWED_ORIGINS: "http://localhost:5173",
  ADMIN_DATABASE_URL:
    "postgres://admin_role:admin-password@localhost:5432/cloud",
  ADMIN_BETTER_AUTH_SECRET: "admin-auth-secret-that-is-independent-and-long",
  ADMIN_WEB_PUBLIC_URL: "http://localhost:5174",
  ADMIN_WEB_ALLOWED_ORIGINS: "http://localhost:5174",
  S3_ENDPOINT: "http://localhost:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "site-assets-test",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

test("Admin API config requires independent database role, secret, and origin", () => {
  const config = loadAdminApiConfig(baseEnv);
  assert.equal(config.port, 8788);
  assert.deepEqual(config.allowedOrigins, ["http://localhost:5174"]);
  assert.equal(config.s3ForcePathStyle, true);
  assert.throws(
    () =>
      loadAdminApiConfig({
        ...baseEnv,
        ADMIN_DATABASE_URL:
          "postgres://ordinary_role:ordinary-password@localhost:5432/cloud",
      }),
    /distinct/,
  );
  assert.throws(
    () =>
      loadAdminApiConfig({
        ...baseEnv,
        ADMIN_BETTER_AUTH_SECRET: baseEnv.BETTER_AUTH_SECRET,
      }),
    /independent/,
  );
  assert.throws(
    () =>
      loadAdminApiConfig({
        ...baseEnv,
        ADMIN_WEB_ALLOWED_ORIGINS: "http://localhost:5173",
      }),
    /origins must be distinct/,
  );
});

test("Admin API runtime can omit ordinary credentials while retaining isolation metadata", () => {
  const runtimeEnv = { ...baseEnv };
  Reflect.deleteProperty(runtimeEnv, "BETTER_AUTH_SECRET");
  const config = loadAdminApiConfig(runtimeEnv);
  assert.equal(config.databaseUrl.includes("admin_role"), true);
});

test("Admin API config supports virtual-hosted object storage", () => {
  const config = loadAdminApiConfig({
    ...baseEnv,
    S3_FORCE_PATH_STYLE: "false",
  });
  assert.equal(config.s3ForcePathStyle, false);
});

test("Admin API config rejects credential-bearing or path-bearing origins", () => {
  assert.throws(
    () =>
      loadAdminApiConfig({
        ...baseEnv,
        ADMIN_WEB_ALLOWED_ORIGINS: "https://user:pass@example.com",
      }),
    /Invalid/,
  );
  assert.throws(
    () =>
      loadAdminApiConfig({
        ...baseEnv,
        ADMIN_WEB_ALLOWED_ORIGINS: "https://admin.example.com/path",
      }),
    /Invalid/,
  );
});

test("Admin API config requires managed SMTP keys in protected environments", () => {
  assert.throws(
    () => loadAdminApiConfig({ ...baseEnv, NODE_ENV: "staging" }),
    /SMTP_CREDENTIAL_KEYS/,
  );
  const keys = JSON.stringify({ 3: Buffer.alloc(32, 3).toString("base64") });
  const storageKeys = JSON.stringify({
    2: Buffer.alloc(32, 2).toString("base64"),
  });
  const config = loadAdminApiConfig({
    ...baseEnv,
    NODE_ENV: "staging",
    SMTP_CREDENTIAL_KEYS: keys,
    SMTP_CREDENTIAL_ACTIVE_KEY_VERSION: "3",
    OBJECT_STORAGE_CREDENTIAL_KEYS: storageKeys,
    OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION: "2",
  });
  assert.equal(config.smtpCredentialKeys, keys);
  assert.equal(config.smtpCredentialActiveKeyVersion, 3);
  assert.equal(config.objectStorageCredentialKeys, storageKeys);
  assert.equal(config.objectStorageCredentialActiveKeyVersion, 2);
  assert.throws(
    () =>
      loadAdminApiConfig({
        ...baseEnv,
        SMTP_CREDENTIAL_ACTIVE_KEY_VERSION: "not-a-version",
      }),
    /SMTP_CREDENTIAL_ACTIVE_KEY_VERSION/,
  );
});
