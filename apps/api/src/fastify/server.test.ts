import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createMetricsRegistry } from "@ai-canvas-cloud/shared";
import { DEFAULT_SITE_CONFIG } from "@ai-canvas-cloud/contracts/site-config";
import type {
  AssetCleanupSummary,
  AssetResponse,
  AssetUploadResponse,
  AssetUrlResponse,
  AuthSessionResponse,
  CompleteAssetUploadResponse,
} from "@ai-canvas-cloud/contracts";
import type {
  AssetCleanupService,
  AssetService,
} from "@ai-canvas-cloud/server/modules/assets";
import {
  createUnavailableAuthService,
  type AuthRequestContext,
  type AuthService,
} from "@ai-canvas-cloud/server/modules/auth";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { WorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
import {
  validateGenerationTelemetryRequest,
  type GenerationTelemetryService,
} from "@ai-canvas-cloud/server/modules/generation-telemetry";
import type { ApiConfig } from "../config.ts";
import type { RateLimiter } from "../rateLimit.ts";
import {
  closeApiServer,
  createApiServer,
  type ServerOptions,
} from "../../dist/server.js";
import { createFastifyApiServer } from "../../dist/fastify/server.js";

const config: ApiConfig = {
  env: "test",
  httpAdapter: "legacy",
  logLevel: "error",
  host: "127.0.0.1",
  port: 0,
  trustProxy: false,
  shutdownTimeoutMs: 1_000,
  betterAuthUrl: "http://127.0.0.1:8787",
  betterAuthSecret: "test-better-auth-secret-that-is-long-enough",
  webPublicUrl: "http://localhost:5173",
  webAllowedOrigins: ["http://localhost:5173"],
  databaseUrl: "postgres://localhost:5432/ai_canvas_cloud",
  redisUrl: "redis://localhost:6379",
  objectStorageEnvironmentFallback: true,
  s3Endpoint: "http://localhost:9000",
  s3PublicEndpoint: "http://localhost:9000",
  s3PublicOrigin: "http://localhost:9000",
  s3ForcePathStyle: true,
  s3Bucket: "ai-canvas-cloud",
  s3Region: "local",
  s3AccessKeyId: "test",
  s3SecretAccessKey: "test",
  objectStorageCredentialActiveKeyVersion: 1,
  assetMaintenanceToken: "asset-maintenance-token-for-tests-123456",
  devSeedAdmin: false,
  devSeedAdminUsername: "admin_user",
  devSeedAdminEmail: "admin@example.com",
  authEmailTransport: "development",
  smtpSecure: false,
  smtpCredentialActiveKeyVersion: 1,
};

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function request(
  port: number,
  path: string,
  method = "GET",
  headers: http.OutgoingHttpHeaders = {},
  body?: string | Buffer,
) {
  return new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const outgoing = http.request(
      { host: "127.0.0.1", port, path, method, headers },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            statusCode: incoming.statusCode ?? 0,
            headers: incoming.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function jsonHeaders(body: string | Buffer) {
  return {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  };
}

function normalizeError(text: string) {
  const payload = JSON.parse(text) as { error: Record<string, unknown> };
  Reflect.deleteProperty(payload.error, "requestId");
  return payload;
}

function normalizeHealth(text: string) {
  const payload = JSON.parse(text) as Record<string, unknown>;
  Reflect.deleteProperty(payload, "requestId");
  Reflect.deleteProperty(payload, "checkedAt");
  Reflect.deleteProperty(payload, "uptimeSeconds");
  const dependencies = payload.dependencies as
    Record<string, Record<string, unknown>> | undefined;
  for (const dependency of Object.values(dependencies ?? {})) {
    Reflect.deleteProperty(dependency, "latencyMs");
  }
  return payload;
}

function createWorkspaceServices() {
  const contexts: AuthRequestContext[] = [];
  const actors: Array<{ userId: string; workspaceId: string }> = [];
  const session: AuthSessionResponse = {
    user: {
      id: "user_1",
      userNumber: 10001,
      username: "Artist_01",
      email: "artist@example.com",
      status: "active",
      emailVerified: true,
    },
    workspace: {
      id: "workspace_1",
      type: "personal",
      name: "Artist workspace",
      role: "owner",
      status: "active",
      planKey: "free",
    },
  };
  const authService: AuthService = {
    ...createUnavailableAuthService(),
    async getSession(context) {
      contexts.push(context);
      return session;
    },
  };
  const workspaceUsageService: WorkspaceUsageService = {
    async getCurrentUsage(actor) {
      actors.push(actor);
      return {
        workspaceId: actor.workspaceId,
        storage: {
          usedBytes: 1024,
          reservedBytes: 512,
          totalBytes: 1536,
          quotaBytes: 10_737_418_240,
          availableBytes: 10_737_416_704,
        },
        projects: [
          {
            projectId: "11111111-1111-4111-8111-111111111111",
            name: "Project A",
            fileCount: 2,
            nodeCount: 4,
            storageBytes: 1024,
            archivedAt: null,
            updatedAt: "2026-07-15T00:00:00.000Z",
          },
        ],
      };
    },
  };
  return { actors, authService, contexts, workspaceUsageService };
}

function createTelemetryServices() {
  const auth = createWorkspaceServices();
  const calls: Array<{
    input: unknown;
    actor: { userId: string; workspaceId: string };
  }> = [];
  const generationTelemetryService: GenerationTelemetryService = {
    async record(rawInput, actor) {
      const input = validateGenerationTelemetryRequest(rawInput);
      calls.push({ input, actor });
      return {
        accepted: true,
        attemptId: input.attemptId,
        status: input.status,
      };
    },
  };
  return { ...auth, calls, generationTelemetryService };
}

function createAssetServices() {
  const auth = createWorkspaceServices();
  const calls: Array<{
    method: string;
    input: unknown;
    actor: { userId: string; workspaceId: string };
  }> = [];
  const uploadId = "55555555-5555-4555-8555-555555555555";
  const assetId = "66666666-6666-4666-8666-666666666666";
  const asset = (status: "pending" | "completed") => ({
    id: assetId,
    projectId: "11111111-1111-4111-8111-111111111111",
    originalFileName: "reference.png",
    mimeType: "image/png",
    byteSize: 2048,
    sha256: null,
    width: null,
    height: null,
    assetKind: "upload" as const,
    status,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:10:00.000Z",
  });
  const upload = (status: "pending" | "completed") => ({
    id: uploadId,
    assetId,
    projectId: "11111111-1111-4111-8111-111111111111",
    originalFileName: "reference.png",
    expectedMimeType: "image/png",
    expectedByteSize: 2048,
    expectedSha256: null,
    assetKind: "upload" as const,
    status,
    expiresAt: "2026-07-15T00:15:00.000Z",
    createdAt: "2026-07-15T00:00:00.000Z",
  });
  const assetService: AssetService = {
    async createUpload(input, actor): Promise<AssetUploadResponse> {
      calls.push({ method: "create", input, actor });
      if (input.originalFileName === "quota.png") {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "QUOTA_EXCEEDED",
          message: "Workspace storage quota exceeded",
          details: { availableBytes: 0, requestedBytes: input.byteSize },
        });
      }
      return {
        upload: upload("pending"),
        asset: asset("pending"),
        directUpload: {
          method: "PUT",
          url: "http://localhost:9000/presigned-upload",
          headers: { "content-type": input.mimeType },
          expiresAt: "2026-07-15T00:15:00.000Z",
        },
      };
    },
    async completeUpload(input, actor): Promise<CompleteAssetUploadResponse> {
      calls.push({ method: "complete", input, actor });
      return { upload: upload("completed"), asset: asset("completed") };
    },
    async getAsset(input, actor): Promise<AssetResponse> {
      calls.push({ method: "get", input, actor });
      return { asset: { ...asset("completed"), id: input } };
    },
    async getAssetUrl(input, actor): Promise<AssetUrlResponse> {
      calls.push({ method: "url", input, actor });
      return {
        assetId: input,
        url: "http://localhost:9000/presigned-read",
        expiresAt: "2026-07-15T00:15:00.000Z",
      };
    },
  };
  return { ...auth, assetId, assetService, calls, uploadId };
}

function createAssetCleanupServices() {
  const calls: boolean[] = [];
  const assetCleanupService: AssetCleanupService = {
    async run(input): Promise<AssetCleanupSummary> {
      calls.push(input.apply);
      if (input.apply) throw new Error("cleanup failed");
      return {
        mode: "preview",
        graceHours: 168,
        cutoff: "2026-07-22T00:00:00.000Z",
        scannedAssetCount: 2,
        reclaimableObjectCount: 1,
        reclaimableBytes: 42,
        deletedObjectCount: 0,
        deletedBytes: 0,
        missingObjectCount: 0,
        finalizedMissingAssetCount: 0,
        retainedAssetCount: 1,
        truncated: false,
        completedAt: "2026-07-29T00:00:00.000Z",
      };
    },
  };
  return { assetCleanupService, calls };
}

function createAuthLifecycleServices() {
  const base = createWorkspaceServices();
  const calls: Array<{
    method: string;
    input?: unknown;
    context: AuthRequestContext;
  }> = [];
  const success = {
    user: {
      id: "user_1",
      userNumber: 10001,
      username: "Artist_01",
      email: "artist@example.com",
      status: "active" as const,
      emailVerified: true,
    },
    workspace: {
      id: "workspace_1",
      type: "personal" as const,
      name: "Artist workspace",
      role: "owner" as const,
      status: "active" as const,
      planKey: "free",
    },
    session: { expiresAt: "2026-08-30T00:00:00.000Z" },
  };
  const authService: AuthService = {
    ...base.authService,
    async register(input, context) {
      calls.push({ method: "register", input, context });
      return {
        response: success,
        setCookieHeaders: [
          "better-auth.session_token=registered; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async login(input, context) {
      calls.push({ method: "login", input, context });
      if (input.identifier === "conflict") {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "SESSION_TAKEOVER_REQUIRED",
          message: "Another device is active",
          details: { activeDevice: "Other Browser" },
        });
      }
      return {
        response: success,
        setCookieHeaders: [
          "better-auth.session_token=logged-in; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async logout(context) {
      calls.push({ method: "logout", context });
      return {
        setCookieHeaders: [
          "better-auth.session_token=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async listSessions(context) {
      calls.push({ method: "listSessions", context });
      return {
        sessions: [
          {
            id: "session_current",
            deviceLabel: "Test Browser",
            createdAt: "2026-07-01T00:00:00.000Z",
            lastUsedAt: "2026-07-30T00:00:00.000Z",
            expiresAt: "2026-08-30T00:00:00.000Z",
            current: true,
          },
        ],
      };
    },
    async listDevices(context) {
      calls.push({ method: "listDevices", context });
      return {
        devices: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            deviceLabel: "Test Browser",
            firstSeenAt: "2026-07-01T00:00:00.000Z",
            lastSeenAt: "2026-07-30T00:00:00.000Z",
            current: true,
          },
        ],
      };
    },
    async sendRegistrationEmailCode(input, context) {
      calls.push({ method: "registrationCode", input, context });
      return { ok: true, resendAfterSeconds: 60 };
    },
    async requestPasswordReset(input, context) {
      calls.push({ method: "passwordForgot", input, context });
      return { ok: true };
    },
    async resetPassword(input, context) {
      calls.push({ method: "passwordReset", input, context });
      return { ok: true };
    },
    async changePassword(input, context) {
      calls.push({ method: "passwordChange", input, context });
      return {
        response: { ok: true },
        setCookieHeaders: [
          "better-auth.session_token=changed; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async revokeSession(sessionId, context) {
      calls.push({ method: "revokeSession", input: sessionId, context });
      return {
        response: { ok: true },
        setCookieHeaders: [
          "better-auth.session_token=current; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async removeDevice(deviceId, context) {
      calls.push({ method: "removeDevice", input: deviceId, context });
      return { ok: true };
    },
  };
  return { ...base, authService, calls };
}

test("Fastify system routes preserve legacy status, headers, and payloads", async () => {
  const etag = `"${"a".repeat(64)}"`;
  const baseOptions: ServerOptions = {
    config,
    siteConfigService: {
      async getCurrent() {
        return {
          etag,
          config: DEFAULT_SITE_CONFIG,
          assets: { logo: null, favicon: null },
        };
      },
    },
    readinessChecks: {
      async postgres() {},
      async redis() {},
      async objectStorage() {},
    },
  };
  const legacy = createApiServer({
    ...baseOptions,
    metrics: createMetricsRegistry(),
  });
  const fastifyMetrics = createMetricsRegistry();
  const fastify = await createFastifyApiServer({
    ...baseOptions,
    metrics: fastifyMetrics,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    for (const path of [
      "/health/live",
      "/api/v1/health/live",
      "/health/ready",
      "/api/v1/health/ready",
    ]) {
      const [before, after] = await Promise.all([
        request(legacyPort, path),
        request(fastifyPort, path),
      ]);
      assert.equal(after.statusCode, before.statusCode, path);
      assert.equal(
        after.headers["content-type"],
        before.headers["content-type"],
      );
      assert.equal(after.headers["x-content-type-options"], "nosniff");
      assert.deepEqual(
        normalizeHealth(after.text),
        normalizeHealth(before.text),
      );
    }

    const [legacySiteConfig, fastifySiteConfig] = await Promise.all([
      request(legacyPort, "/api/v1/site-config"),
      request(fastifyPort, "/api/v1/site-config"),
    ]);
    assert.equal(fastifySiteConfig.statusCode, legacySiteConfig.statusCode);
    assert.equal(fastifySiteConfig.text, legacySiteConfig.text);
    assert.equal(
      fastifySiteConfig.headers["content-type"],
      legacySiteConfig.headers["content-type"],
    );
    assert.equal(fastifySiteConfig.headers.etag, legacySiteConfig.headers.etag);
    assert.equal(
      fastifySiteConfig.headers["cache-control"],
      legacySiteConfig.headers["cache-control"],
    );

    const [legacyCached, fastifyCached] = await Promise.all([
      request(legacyPort, "/api/v1/site-config", "GET", {
        "if-none-match": etag,
      }),
      request(fastifyPort, "/api/v1/site-config", "GET", {
        "if-none-match": etag,
      }),
    ]);
    assert.equal(fastifyCached.statusCode, legacyCached.statusCode);
    assert.equal(fastifyCached.text, legacyCached.text);
    assert.equal(fastifyCached.headers.etag, legacyCached.headers.etag);
    assert.equal(
      fastifyCached.headers["cache-control"],
      legacyCached.headers["cache-control"],
    );

    const wrongMethod = await request(fastifyPort, "/health/live", "POST");
    assert.equal(wrongMethod.statusCode, 404);
    assert.equal(
      (JSON.parse(wrongMethod.text) as { error: { code: string } }).error.code,
      "SERVICE_UNAVAILABLE",
    );
    assert.equal(
      (await request(fastifyPort, "/api/v1/not-migrated")).statusCode,
      404,
    );
    assert.equal(
      (await request(fastifyPort, "/health/live", "OPTIONS")).statusCode,
      204,
    );
    const metrics = await request(fastifyPort, "/metrics");
    assert.match(
      metrics.text,
      /ai_canvas_api_requests_total\{method="OPTIONS",route="\/health\/live",status_class="2xx"\} 1/,
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify site configuration preserves legacy unavailable errors", async () => {
  const options: ServerOptions = {
    config,
    siteConfigService: {
      async getCurrent() {
        throw new Error("unavailable");
      },
    },
  };
  const legacy = createApiServer(options);
  const fastify = await createFastifyApiServer(options);
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    const [before, after] = await Promise.all([
      request(legacyPort, "/api/v1/site-config"),
      request(fastifyPort, "/api/v1/site-config"),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.headers["content-type"], before.headers["content-type"]);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify workspace routes preserve legacy auth context and trusted actors", async () => {
  const legacyServices = createWorkspaceServices();
  const fastifyServices = createWorkspaceServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const headers = {
    cookie: "better-auth.session_token=signed_session",
    "user-agent": "workspace-contract-test",
  };

  try {
    const [legacyAnonymous, fastifyAnonymous] = await Promise.all([
      request(legacyPort, "/api/v1/workspaces/current"),
      request(fastifyPort, "/api/v1/workspaces/current"),
    ]);
    assert.equal(fastifyAnonymous.statusCode, legacyAnonymous.statusCode);
    assert.deepEqual(
      normalizeError(fastifyAnonymous.text),
      normalizeError(legacyAnonymous.text),
    );

    for (const path of [
      "/api/v1/workspaces/current?workspaceId=forged",
      "/api/v1/workspaces/current/usage?workspaceId=forged&userId=forged",
    ]) {
      const [before, after] = await Promise.all([
        request(legacyPort, path, "GET", headers),
        request(fastifyPort, path, "GET", headers),
      ]);
      assert.equal(after.statusCode, before.statusCode, path);
      assert.equal(
        after.headers["content-type"],
        before.headers["content-type"],
      );
      assert.equal(after.text, before.text, path);
    }

    assert.deepEqual(fastifyServices.actors, legacyServices.actors);
    assert.deepEqual(fastifyServices.actors, [
      { userId: "user_1", workspaceId: "workspace_1" },
    ]);
    assert.equal(fastifyServices.contexts.length, 2);
    assert.equal(
      fastifyServices.contexts[0]?.cookieHeader,
      legacyServices.contexts[0]?.cookieHeader,
    );
    assert.equal(
      fastifyServices.contexts[0]?.userAgent,
      legacyServices.contexts[0]?.userAgent,
    );
    assert.equal(
      fastifyServices.contexts[0]?.ipAddress,
      legacyServices.contexts[0]?.ipAddress,
    );
    assert.match(fastifyServices.contexts[0]?.requestId ?? "", /^[\w-]+$/);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify workspace rate limits preserve legacy trusted scopes", async () => {
  function createRateLimiter() {
    const calls: Array<{ bucket: string; scopes: string[] }> = [];
    const rateLimiter: RateLimiter = {
      async consume(bucket, scopes) {
        calls.push({ bucket, scopes });
        return scopes.some((scope) => scope.startsWith("user:"))
          ? {
              allowed: false,
              available: true,
              retryAfterSeconds: 17,
              bucket,
            }
          : { allowed: true, available: true, retryAfterSeconds: 0, bucket };
      },
      async ping() {},
      async close() {},
    };
    return { calls, rateLimiter };
  }

  const legacyServices = createWorkspaceServices();
  const fastifyServices = createWorkspaceServices();
  const legacyLimit = createRateLimiter();
  const fastifyLimit = createRateLimiter();
  const legacy = createApiServer({
    config,
    ...legacyServices,
    rateLimiter: legacyLimit.rateLimiter,
  });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
    rateLimiter: fastifyLimit.rateLimiter,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    const headers = { cookie: "better-auth.session_token=signed_session" };
    const [before, after] = await Promise.all([
      request(legacyPort, "/api/v1/workspaces/current", "GET", headers),
      request(fastifyPort, "/api/v1/workspaces/current", "GET", headers),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.headers["retry-after"], before.headers["retry-after"]);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    assert.deepEqual(fastifyLimit.calls, legacyLimit.calls);
    assert.deepEqual(fastifyLimit.calls[1], {
      bucket: "read",
      scopes: ["user:user_1", "workspace:workspace_1"],
    });
    assert.equal(fastifyServices.contexts.length, 1);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify telemetry preserves legacy auth, JSON, and domain validation", async () => {
  const legacyServices = createTelemetryServices();
  const fastifyServices = createTelemetryServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const path = "/api/v1/telemetry/generations?userId=forged&workspaceId=forged";
  const cookie = "better-auth.session_token=signed_session";
  const validBody = JSON.stringify({
    attemptId: "11111111-1111-4111-8111-111111111111",
    category: "image",
    status: "started",
  });

  try {
    const invalidJson = "{";
    const [legacyAnonymous, fastifyAnonymous] = await Promise.all([
      request(legacyPort, path, "POST", jsonHeaders(invalidJson), invalidJson),
      request(fastifyPort, path, "POST", jsonHeaders(invalidJson), invalidJson),
    ]);
    assert.equal(fastifyAnonymous.statusCode, legacyAnonymous.statusCode);
    assert.deepEqual(
      normalizeError(fastifyAnonymous.text),
      normalizeError(legacyAnonymous.text),
    );

    const validHeaders = { ...jsonHeaders(validBody), cookie };
    const [before, after] = await Promise.all([
      request(legacyPort, path, "POST", validHeaders, validBody),
      request(fastifyPort, path, "POST", validHeaders, validBody),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.text, before.text);
    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
    assert.deepEqual(fastifyServices.calls[0]?.actor, {
      userId: "user_1",
      workspaceId: "workspace_1",
    });

    for (const invalidBody of [
      "{",
      '{"status":"started","status":"failed"}',
      Buffer.from([0xc3, 0x28]),
      `${"[".repeat(65)}0${"]".repeat(65)}`,
    ]) {
      const invalidHeaders = { ...jsonHeaders(invalidBody), cookie };
      const [legacyInvalid, fastifyInvalid] = await Promise.all([
        request(legacyPort, path, "POST", invalidHeaders, invalidBody),
        request(fastifyPort, path, "POST", invalidHeaders, invalidBody),
      ]);
      assert.equal(fastifyInvalid.statusCode, legacyInvalid.statusCode);
      assert.deepEqual(
        normalizeError(fastifyInvalid.text),
        normalizeError(legacyInvalid.text),
      );
    }

    const privateBody = JSON.stringify({
      ...JSON.parse(validBody),
      model: "private-model",
    });
    const privateHeaders = { ...jsonHeaders(privateBody), cookie };
    const [legacyPrivate, fastifyPrivate] = await Promise.all([
      request(legacyPort, path, "POST", privateHeaders, privateBody),
      request(fastifyPort, path, "POST", privateHeaders, privateBody),
    ]);
    assert.equal(fastifyPrivate.statusCode, legacyPrivate.statusCode);
    assert.deepEqual(
      normalizeError(fastifyPrivate.text),
      normalizeError(legacyPrivate.text),
    );
    assert.equal(fastifyServices.calls.length, 1);

    const oversizedBody = JSON.stringify({ value: "x".repeat(2 * 1024) });
    const oversizedHeaders = { ...jsonHeaders(oversizedBody), cookie };
    const [legacyOversized, fastifyOversized] = await Promise.all([
      request(legacyPort, path, "POST", oversizedHeaders, oversizedBody),
      request(fastifyPort, path, "POST", oversizedHeaders, oversizedBody),
    ]);
    assert.equal(fastifyOversized.statusCode, legacyOversized.statusCode);
    assert.deepEqual(
      normalizeError(fastifyOversized.text),
      normalizeError(legacyOversized.text),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify telemetry preserves legacy CSRF and fail-closed rate limiting order", async () => {
  function unavailableRateLimiter(): RateLimiter {
    return {
      async consume(bucket) {
        return {
          allowed: false,
          available: false,
          retryAfterSeconds: 1,
          bucket,
        };
      },
      async ping() {},
      async close() {},
    };
  }

  const legacyServices = createTelemetryServices();
  const fastifyServices = createTelemetryServices();
  const legacy = createApiServer({
    config,
    ...legacyServices,
    rateLimiter: unavailableRateLimiter(),
  });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
    rateLimiter: unavailableRateLimiter(),
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const invalidJson = "{";
  const headers = jsonHeaders(invalidJson);

  try {
    const [before, after] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/telemetry/generations",
        "POST",
        headers,
        invalidJson,
      ),
      request(
        fastifyPort,
        "/api/v1/telemetry/generations",
        "POST",
        headers,
        invalidJson,
      ),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.headers["retry-after"], before.headers["retry-after"]);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    assert.equal(fastifyServices.contexts.length, 0);
    assert.equal(fastifyServices.calls.length, 0);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }

  const productionConfig = { ...config, env: "production" as const };
  const legacyCsrf = createApiServer({
    config: productionConfig,
    ...createTelemetryServices(),
  });
  const fastifyCsrf = await createFastifyApiServer({
    config: productionConfig,
    ...createTelemetryServices(),
  });
  const legacyCsrfPort = await listen(legacyCsrf);
  const fastifyCsrfPort = await listen(fastifyCsrf);
  const cookieHeaders = {
    ...headers,
    cookie: "better-auth.session_token=signed_session",
  };
  try {
    const [before, after] = await Promise.all([
      request(
        legacyCsrfPort,
        "/api/v1/telemetry/generations",
        "POST",
        cookieHeaders,
        invalidJson,
      ),
      request(
        fastifyCsrfPort,
        "/api/v1/telemetry/generations",
        "POST",
        cookieHeaders,
        invalidJson,
      ),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
  } finally {
    await Promise.all([
      closeApiServer(legacyCsrf, 1_000),
      closeApiServer(fastifyCsrf, 1_000),
    ]);
  }
});

test("Fastify auth lifecycle preserves legacy payloads and cookies", async () => {
  const legacyServices = createAuthLifecycleServices();
  const fastifyServices = createAuthLifecycleServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const cookie = "better-auth.session_token=signed_session";
  const cases: Array<{
    method: string;
    path: string;
    body?: unknown;
    cookie?: string;
  }> = [
    {
      method: "POST",
      path: "/api/v1/auth/register",
      body: {
        username: "Artist_01",
        email: "artist@example.com",
        password: "long-enough-password",
        acceptedTermsAndPrivacy: true,
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { identifier: "Artist_01", password: "long-enough-password" },
    },
    { method: "GET", path: "/api/v1/auth/session", cookie },
    { method: "GET", path: "/api/v1/auth/sessions", cookie },
    { method: "GET", path: "/api/v1/auth/devices", cookie },
    {
      method: "POST",
      path: "/api/v1/auth/registration/email-code",
      body: { email: "artist@example.com" },
    },
    {
      method: "POST",
      path: "/api/v1/auth/password/forgot",
      body: { email: "artist@example.com" },
    },
    {
      method: "POST",
      path: "/api/v1/auth/password/reset",
      body: {
        email: "artist@example.com",
        code: "123456",
        password: "new-long-enough-password",
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/password/change",
      cookie,
      body: {
        currentPassword: "long-enough-password",
        newPassword: "new-long-enough-password",
      },
    },
    {
      method: "DELETE",
      path: "/api/v1/auth/sessions/session_other",
      cookie,
    },
    {
      method: "DELETE",
      path: "/api/v1/auth/devices/11111111-1111-4111-8111-111111111111",
      cookie,
    },
    { method: "POST", path: "/api/v1/auth/logout", cookie },
    { method: "POST", path: "/api/v1/auth/logout" },
  ];

  try {
    for (const entry of cases) {
      const body =
        entry.body === undefined ? undefined : JSON.stringify(entry.body);
      const headers = {
        ...(body ? jsonHeaders(body) : {}),
        ...(entry.cookie ? { cookie: entry.cookie } : {}),
        "user-agent": "auth-contract-test",
      };
      const [before, after] = await Promise.all([
        request(legacyPort, entry.path, entry.method, headers, body),
        request(fastifyPort, entry.path, entry.method, headers, body),
      ]);
      assert.equal(after.statusCode, before.statusCode, entry.path);
      assert.equal(after.text, before.text, entry.path);
      assert.deepEqual(
        after.headers["set-cookie"],
        before.headers["set-cookie"],
        entry.path,
      );
    }
    assert.deepEqual(
      fastifyServices.calls.map(({ method, input }) => ({ method, input })),
      legacyServices.calls.map(({ method, input }) => ({ method, input })),
    );
    assert(
      fastifyServices.calls.every(
        ({ context }) =>
          context.userAgent === "auth-contract-test" &&
          Boolean(context.requestId),
      ),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify auth preserves legacy protected-body order and domain errors", async () => {
  const legacyServices = createAuthLifecycleServices();
  const fastifyServices = createAuthLifecycleServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    const invalidBody = "{";
    const invalidHeaders = jsonHeaders(invalidBody);
    const [legacyAnonymous, fastifyAnonymous] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/auth/password/change",
        "POST",
        invalidHeaders,
        invalidBody,
      ),
      request(
        fastifyPort,
        "/api/v1/auth/password/change",
        "POST",
        invalidHeaders,
        invalidBody,
      ),
    ]);
    assert.equal(fastifyAnonymous.statusCode, legacyAnonymous.statusCode);
    assert.deepEqual(
      normalizeError(fastifyAnonymous.text),
      normalizeError(legacyAnonymous.text),
    );

    const conflictBody = JSON.stringify({
      identifier: "conflict",
      password: "long-enough-password",
    });
    const conflictHeaders = jsonHeaders(conflictBody);
    const [before, after] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/auth/login",
        "POST",
        conflictHeaders,
        conflictBody,
      ),
      request(
        fastifyPort,
        "/api/v1/auth/login",
        "POST",
        conflictHeaders,
        conflictBody,
      ),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));

    const oversizedBody = JSON.stringify({
      identifier: "x".repeat(64 * 1024),
      password: "long-enough-password",
    });
    const oversizedHeaders = jsonHeaders(oversizedBody);
    const [legacyOversized, fastifyOversized] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/auth/login",
        "POST",
        oversizedHeaders,
        oversizedBody,
      ),
      request(
        fastifyPort,
        "/api/v1/auth/login",
        "POST",
        oversizedHeaders,
        oversizedBody,
      ),
    ]);
    assert.equal(fastifyOversized.statusCode, legacyOversized.statusCode);
    assert.deepEqual(
      normalizeError(fastifyOversized.text),
      normalizeError(legacyOversized.text),
    );

    for (const path of [
      "/api/v1/auth/logout",
      "/api/v1/auth/sessions/session_other",
      "/api/v1/auth/devices/11111111-1111-4111-8111-111111111111",
    ]) {
      const method = path.endsWith("logout") ? "POST" : "DELETE";
      const ignoredHeaders = {
        ...jsonHeaders(invalidBody),
        cookie: "better-auth.session_token=signed_session",
      };
      const [legacyIgnored, fastifyIgnored] = await Promise.all([
        request(legacyPort, path, method, ignoredHeaders, invalidBody),
        request(fastifyPort, path, method, ignoredHeaders, invalidBody),
      ]);
      assert.equal(fastifyIgnored.statusCode, legacyIgnored.statusCode, path);
      assert.equal(fastifyIgnored.text, legacyIgnored.text, path);
      assert.deepEqual(
        fastifyIgnored.headers["set-cookie"],
        legacyIgnored.headers["set-cookie"],
        path,
      );
    }
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify internal asset cleanup preserves legacy access and failure boundaries", async () => {
  const legacyServices = createAssetCleanupServices();
  const fastifyServices = createAssetCleanupServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({ config, ...fastifyServices });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const tokenHeaders = {
    authorization: `Bearer ${config.assetMaintenanceToken}`,
  };

  try {
    const cases = [
      { headers: {}, body: "{" },
      {
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({ apply: false }),
      },
      { headers: tokenHeaders, body: JSON.stringify({ apply: false }) },
      {
        headers: tokenHeaders,
        body: JSON.stringify({ apply: false, objectKey: "private/key" }),
      },
      { headers: tokenHeaders, body: JSON.stringify({ apply: true }) },
      {
        headers: tokenHeaders,
        body: JSON.stringify({ apply: false, padding: "x".repeat(1_024) }),
      },
    ];
    for (const testCase of cases) {
      const headers = { ...jsonHeaders(testCase.body), ...testCase.headers };
      const [before, after] = await Promise.all([
        request(
          legacyPort,
          "/internal/v1/asset-cleanup",
          "POST",
          headers,
          testCase.body,
        ),
        request(
          fastifyPort,
          "/internal/v1/asset-cleanup",
          "POST",
          headers,
          testCase.body,
        ),
      ]);
      assert.equal(after.statusCode, before.statusCode);
      if (after.statusCode >= 400) {
        assert.deepEqual(
          normalizeError(after.text),
          normalizeError(before.text),
        );
      } else {
        assert.equal(after.text, before.text);
      }
    }
    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify asset routes preserve legacy actors, bodies, and domain errors", async () => {
  const legacyServices = createAssetServices();
  const fastifyServices = createAssetServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({ config, ...fastifyServices });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const cookie = "better-auth.session_token=signed_session";

  async function compare(
    path: string,
    method = "GET",
    body?: string,
    authenticated = true,
  ) {
    const headers = {
      ...(body === undefined ? {} : jsonHeaders(body)),
      ...(authenticated ? { cookie } : {}),
    };
    const [before, after] = await Promise.all([
      request(legacyPort, path, method, headers, body),
      request(fastifyPort, path, method, headers, body),
    ]);
    assert.equal(after.statusCode, before.statusCode, path);
    if (after.statusCode >= 400) {
      assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    } else {
      assert.equal(after.text, before.text);
    }
  }

  try {
    await compare("/api/v1/assets/uploads", "POST", "{", false);
    await compare("/api/v1/assets/uploads", "POST", "{");

    const createBody = JSON.stringify({
      projectId: "11111111-1111-4111-8111-111111111111",
      originalFileName: "reference.png",
      mimeType: "image/png",
      byteSize: 2048,
      assetKind: "upload",
      idempotencyKey: "asset_upload_1",
      userId: "forged-user",
      workspaceId: "forged-workspace",
    });
    await compare("/api/v1/assets/uploads", "POST", createBody);

    const quotaBody = JSON.stringify({
      originalFileName: "quota.png",
      mimeType: "image/png",
      byteSize: 1,
      assetKind: "upload",
      idempotencyKey: "quota-error",
    });
    await compare("/api/v1/assets/uploads", "POST", quotaBody);

    const oversizedBody = JSON.stringify({
      originalFileName: "x".repeat(64 * 1024),
      mimeType: "image/png",
      byteSize: 1,
      assetKind: "upload",
      idempotencyKey: "oversized",
    });
    await compare("/api/v1/assets/uploads", "POST", oversizedBody);

    await compare(
      `/api/v1/assets/uploads/${legacyServices.uploadId}/complete?workspaceId=forged`,
      "POST",
      "{",
    );
    await compare(
      `/api/v1/assets/${legacyServices.assetId}?workspaceId=forged`,
    );
    await compare(`/api/v1/assets/${legacyServices.assetId}/url?userId=forged`);
    await compare("/api/v1/assets/uploads/url");
    await compare("/api/v1/assets/uploads", "GET", undefined, false);

    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
    assert(
      fastifyServices.calls.every(
        ({ actor }) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("OpenAPI is available only in development Fastify mode", async () => {
  const development = await createFastifyApiServer({
    config: { ...config, env: "development", httpAdapter: "fastify" },
  });
  const production = await createFastifyApiServer({
    config: { ...config, env: "production", httpAdapter: "fastify" },
  });
  const developmentPort = await listen(development);
  const productionPort = await listen(production);

  try {
    const specification = await request(developmentPort, "/docs/json");
    assert.equal(specification.statusCode, 200);
    const openapi = JSON.parse(specification.text) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const operationIds = Object.values(openapi.paths).flatMap((path) =>
      Object.values(path)
        .map((operation) => operation.operationId)
        .filter((value): value is string => Boolean(value)),
    );
    assert.equal(operationIds.length, 26);
    assert.equal(new Set(operationIds).size, operationIds.length);
    assert.equal((await request(productionPort, "/docs")).statusCode, 404);
    assert.equal((await request(productionPort, "/docs/json")).statusCode, 404);
  } finally {
    await Promise.all([
      closeApiServer(development, 1_000),
      closeApiServer(production, 1_000),
    ]);
  }
});
