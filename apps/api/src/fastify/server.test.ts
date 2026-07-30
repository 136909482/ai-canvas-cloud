import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createMetricsRegistry } from "@ai-canvas-cloud/shared";
import type { ApiConfig } from "../config.ts";
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

function request(port: number, path: string, method = "GET") {
  return new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const outgoing = http.request(
      { host: "127.0.0.1", port, path, method },
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

function normalizeHealth(text: string) {
  const payload = JSON.parse(text) as Record<string, unknown>;
  Reflect.deleteProperty(payload, "requestId");
  Reflect.deleteProperty(payload, "checkedAt");
  Reflect.deleteProperty(payload, "uptimeSeconds");
  return payload;
}

test("Fastify system routes preserve legacy status, headers, and payloads", async () => {
  const baseOptions: ServerOptions = {
    config,
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
    assert.equal(operationIds.length, 5);
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
