import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type {
  AdminAssetCleanupService,
  AdminDashboardService,
  AdminObjectStorageConfigService,
  AdminService,
  AdminSiteConfigService,
  AdminSmtpConfigService,
  AdminUserOperationsService,
} from "@ai-canvas-cloud/server/modules/admin";
import { ADMIN_ROUTE_INVENTORY } from "../routeInventory.ts";
import { closeAdminApiServer, createAdminApiServer } from "../server.ts";
import { createFastifyAdminApiServer } from "./server.ts";

const config = {
  env: "development",
  httpAdapter: "fastify" as const,
  host: "127.0.0.1",
  port: 8788,
  logLevel: "error" as const,
  shutdownTimeoutMs: 1_000,
  trustProxy: false,
  staticSiteRoot: undefined,
  databaseUrl: "postgres://admin_role@localhost/cloud",
  betterAuthUrl: "http://127.0.0.1:8788",
  betterAuthSecret: "admin-fastify-secret-that-is-long-enough",
  webPublicUrl: "http://localhost:5174",
  allowedOrigins: ["http://localhost:5174"],
  objectStorageEnvironmentFallback: true,
  s3Endpoint: "http://localhost:9000",
  s3PublicEndpoint: "http://localhost:9000",
  s3PublicOrigin: "http://localhost:9000",
  s3ForcePathStyle: true,
  s3Bucket: "test",
  s3Region: "us-east-1",
  s3AccessKeyId: "test",
  s3SecretAccessKey: "test",
  objectStorageCredentialActiveKeyVersion: 1,
  assetMaintenanceApiUrl: "http://127.0.0.1:8787",
  assetMaintenanceToken: "asset-maintenance-token-for-tests-123456",
  smtpCredentialActiveKeyVersion: 1,
  smtpSecure: false,
};

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function serviceProxy<T extends object>(
  overrides: Record<string, unknown> = {},
) {
  return new Proxy(overrides, {
    get(target, property) {
      if (typeof property !== "string") return undefined;
      if (property in target) return target[property];
      return async () => ({ ok: true });
    },
  }) as T;
}

const adminService = serviceProxy<AdminService>({
  createLoginCaptcha: async () => ({ challengeId: "challenge", image: "data" }),
  login: async () => ({ response: { ok: true }, setCookieHeaders: [] }),
  changePassword: async () => ({
    response: { ok: true },
    setCookieHeaders: [],
  }),
  logout: async () => ({ response: { ok: true }, setCookieHeaders: [] }),
});

function request(
  port: number,
  options: {
    path: string;
    method?: string;
    origin?: string;
    cookie?: string;
    csrf?: string;
    body?: unknown;
  },
) {
  return new Promise<{
    status: number;
    text: string;
    headers: http.IncomingHttpHeaders;
  }>((resolve, reject) => {
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.origin) headers.origin = options.origin;
    if (options.cookie) headers.cookie = options.cookie;
    if (options.csrf) headers["x-csrf-token"] = options.csrf;
    if (body) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(body));
    }
    const outgoing = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: options.path,
        method: options.method ?? "GET",
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

function concretePath(path: string) {
  return path
    .replace(":userId", "user_123")
    .replace(":assetId", "123e4567-e89b-42d3-a456-426614174000");
}

function bodyFor(path: string) {
  if (path.endsWith("/auth/login"))
    return { username: "admin", password: "password" };
  if (path.endsWith("/auth/username")) return { username: "admin" };
  if (path.endsWith("/auth/password")) {
    return { currentPassword: "old-password", newPassword: "new-password" };
  }
  if (path.endsWith("/auth/login-security")) return { captchaEnabled: true };
  return {};
}

async function listen(options: { env?: string } = {}) {
  const serverOptions = {
    config: { ...config, ...options },
    adminService,
    dashboardService: serviceProxy<AdminDashboardService>(),
    siteConfigService: serviceProxy<AdminSiteConfigService>(),
    smtpConfigService: serviceProxy<AdminSmtpConfigService>(),
    objectStorageConfigService: serviceProxy<AdminObjectStorageConfigService>(),
    assetCleanupService: serviceProxy<AdminAssetCleanupService>(),
    userOperationsService: serviceProxy<AdminUserOperationsService>(),
    logger,
    readinessChecks: {
      postgres: async () => ({ ok: true, latencyMs: 1 }),
      objectStorage: async () => ({ ok: true, latencyMs: 1 }),
    },
  };
  const server = await createFastifyAdminApiServer(serverOptions);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return { server, port: address.port };
}

async function listenLegacy() {
  const server = createAdminApiServer({
    config,
    adminService,
    dashboardService: serviceProxy<AdminDashboardService>(),
    siteConfigService: serviceProxy<AdminSiteConfigService>(),
    smtpConfigService: serviceProxy<AdminSmtpConfigService>(),
    objectStorageConfigService: serviceProxy<AdminObjectStorageConfigService>(),
    assetCleanupService: serviceProxy<AdminAssetCleanupService>(),
    userOperationsService: serviceProxy<AdminUserOperationsService>(),
    logger,
    readinessChecks: {
      postgres: async () => ({ ok: true, latencyMs: 1 }),
      objectStorage: async () => ({ ok: true, latencyMs: 1 }),
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return { server, port: address.port };
}

function normalizedJson(text: string) {
  const value = JSON.parse(text) as Record<string, unknown>;
  if (value.error && typeof value.error === "object") {
    delete (value.error as Record<string, unknown>).requestId;
  }
  delete value.requestId;
  delete value.checkedAt;
  return value;
}

test("Admin Fastify registers and serves the complete route inventory", async () => {
  const { server, port } = await listen();
  try {
    const csrfResponse = await request(port, { path: "/admin/v1/auth/csrf" });
    assert.equal(csrfResponse.status, 200);
    const csrf = JSON.parse(csrfResponse.text).token as string;
    const cookie = csrfResponse.headers["set-cookie"]?.[0]?.split(";")[0];
    assert(cookie);

    for (const route of ADMIN_ROUTE_INVENTORY) {
      const response = await request(port, {
        path: concretePath(route.path),
        method: route.method,
        ...(route.method === "POST"
          ? {
              origin: "http://localhost:5174",
              cookie,
              csrf,
              body: bodyFor(route.path),
            }
          : {}),
      });
      assert.equal(
        response.status,
        route.operationId === "createAdminSiteAsset" ? 201 : 200,
        `${route.method} ${route.path}: ${response.text}`,
      );
      assert.equal(typeof response.headers["x-request-id"], "string");
    }
  } finally {
    await closeAdminApiServer(server, 1_000);
  }
});

test("Admin Fastify keeps writes behind CSRF and docs outside production", async () => {
  const development = await listen();
  try {
    const denied = await request(development.port, {
      path: "/admin/v1/auth/logout",
      method: "POST",
      origin: "http://localhost:5174",
    });
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(denied.text).error.code, "ADMIN_ACCESS_DENIED");
    assert.equal(
      (await request(development.port, { path: "/docs/json" })).status,
      200,
    );
  } finally {
    await closeAdminApiServer(development.server, 1_000);
  }

  const production = await listen({ env: "production" });
  try {
    assert.equal(
      (await request(production.port, { path: "/docs/json" })).status,
      404,
    );
  } finally {
    await closeAdminApiServer(production.server, 1_000);
  }
});

test("Admin Fastify preserves legacy route payload and header contracts", async () => {
  const legacy = await listenLegacy();
  const fastify = await listen();
  try {
    const legacyCsrf = await request(legacy.port, {
      path: "/admin/v1/auth/csrf",
    });
    const fastifyCsrf = await request(fastify.port, {
      path: "/admin/v1/auth/csrf",
    });
    const legacyToken = JSON.parse(legacyCsrf.text).token as string;
    const fastifyToken = JSON.parse(fastifyCsrf.text).token as string;
    const legacyCookie = legacyCsrf.headers["set-cookie"]?.[0]?.split(";")[0];
    const fastifyCookie = fastifyCsrf.headers["set-cookie"]?.[0]?.split(";")[0];
    assert(legacyCookie && fastifyCookie);

    const comparableRoutes = ADMIN_ROUTE_INVENTORY.filter(
      (route) =>
        ![
          "getAdminPrometheusMetrics",
          "getAdminHealthLive",
          "getAdminHealthReady",
          "getAdminCsrfToken",
        ].includes(route.operationId),
    );
    for (const route of comparableRoutes) {
      const common = {
        path: concretePath(route.path),
        method: route.method,
        ...(route.method === "POST"
          ? { origin: "http://localhost:5174", body: bodyFor(route.path) }
          : {}),
      };
      const legacyResponse = await request(legacy.port, {
        ...common,
        ...(route.method === "POST"
          ? { cookie: legacyCookie, csrf: legacyToken }
          : {}),
      });
      const fastifyResponse = await request(fastify.port, {
        ...common,
        ...(route.method === "POST"
          ? { cookie: fastifyCookie, csrf: fastifyToken }
          : {}),
      });
      assert.equal(
        fastifyResponse.status,
        legacyResponse.status,
        route.operationId,
      );
      assert.deepEqual(
        normalizedJson(fastifyResponse.text),
        normalizedJson(legacyResponse.text),
        route.operationId,
      );
      assert.equal(
        fastifyResponse.headers["content-type"],
        legacyResponse.headers["content-type"],
        route.operationId,
      );
      assert.equal(fastifyResponse.headers["cache-control"], "no-store");
    }
  } finally {
    await Promise.all([
      closeAdminApiServer(legacy.server, 1_000),
      closeAdminApiServer(fastify.server, 1_000),
    ]);
  }
});
