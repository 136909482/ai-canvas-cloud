import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createMetricsRegistry } from "@ai-canvas-cloud/shared";
import { DEFAULT_SITE_CONFIG } from "@ai-canvas-cloud/contracts/site-config";
import type { AuthSessionResponse } from "@ai-canvas-cloud/contracts";
import {
  createUnavailableAuthService,
  type AuthRequestContext,
  type AuthService,
} from "@ai-canvas-cloud/server/modules/auth";
import type { WorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
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
    outgoing.end();
  });
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
    assert.equal(operationIds.length, 8);
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
