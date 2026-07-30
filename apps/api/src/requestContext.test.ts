import assert from "node:assert/strict";
import test from "node:test";
import { getRateLimitBucket } from "./requestContext.ts";

test("request rate-limit buckets preserve public API policy boundaries", () => {
  for (const path of [
    "/metrics",
    "/health/live",
    "/health/ready",
    "/api/v1/health/live",
    "/api/v1/health/ready",
    "/api/v1/site-config",
    "/docs",
    "/docs/json",
  ]) {
    assert.equal(getRateLimitBucket("GET", path), null, path);
  }
  assert.equal(getRateLimitBucket("OPTIONS", "/api/v1/projects"), null);
  assert.equal(
    getRateLimitBucket("POST", "/api/v1/auth/login"),
    "auth_attempt",
  );
  assert.equal(
    getRateLimitBucket("POST", "/api/v1/auth/password/reset"),
    "password_email",
  );
  assert.equal(
    getRateLimitBucket("POST", "/api/v1/assets/uploads"),
    "asset_prepare",
  );
  assert.equal(
    getRateLimitBucket("POST", "/api/v1/migrations/imports/prepare"),
    "migration_prepare",
  );
  assert.equal(getRateLimitBucket("GET", "/api/v1/projects"), "read");
  assert.equal(getRateLimitBucket("POST", "/api/v1/projects"), "write");
});
