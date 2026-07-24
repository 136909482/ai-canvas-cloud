import assert from "node:assert/strict";
import test from "node:test";
import { loadAdminApiConfig } from "./config.ts";

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL:
    "postgres://ordinary_role:ordinary-password@localhost:5432/cloud",
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
  assert.throws(
    () =>
      loadAdminApiConfig({
        ...baseEnv,
        ADMIN_DATABASE_URL: baseEnv.DATABASE_URL,
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
