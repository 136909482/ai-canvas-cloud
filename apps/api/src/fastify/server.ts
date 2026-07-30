import http, { type RequestListener } from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import {
  createJsonLogger,
  createMetricsRegistry,
  createRequestId,
} from "@ai-canvas-cloud/shared";
import { createUnavailablePublicSiteConfigService } from "@ai-canvas-cloud/server/modules/admin";
import { createUnavailableAuthService } from "@ai-canvas-cloud/server/modules/auth";
import { createUnavailableWorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
import { createUnavailableGenerationTelemetryService } from "@ai-canvas-cloud/server/modules/generation-telemetry";
import { createUnavailableAssetService } from "@ai-canvas-cloud/server/modules/assets";
import {
  createUnavailableMigrationAssetUploadService,
  createUnavailableMigrationExportService,
  createUnavailableMigrationImportService,
} from "@ai-canvas-cloud/server/modules/migrations";
import {
  HTTP_ADAPTER_CLOSE,
  createApiServer,
  type AdapterHttpServer,
  type ServerOptions,
} from "../server.js";
import { registerFastifyFoundation } from "./plugins.js";
import { createFastifyAuthContextAdapter } from "./authContext.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerTelemetryRoutes } from "./routes/telemetry.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerMigrationRoutes } from "./routes/migrations.js";

const FASTIFY_OWNED_PATHS = new Set([
  "/metrics",
  "/health/live",
  "/health/ready",
  "/api/v1/health/live",
  "/api/v1/health/ready",
  "/api/v1/site-config",
  "/api/v1/workspaces/current",
  "/api/v1/workspaces/current/usage",
  "/api/v1/telemetry/generations",
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/auth/session",
  "/api/v1/auth/sessions",
  "/api/v1/auth/devices",
  "/api/v1/auth/registration/email-code",
  "/api/v1/auth/password/forgot",
  "/api/v1/auth/password/reset",
  "/api/v1/auth/password/change",
  "/internal/v1/asset-cleanup",
  "/api/v1/assets/uploads",
]);

function isFastifyOwnedPath(
  url: string | undefined,
  method: string | undefined,
) {
  const pathname = new URL(url ?? "/", "http://localhost").pathname;
  if (pathname === "/internal/v1/asset-cleanup") {
    return method === "POST" || method === "OPTIONS";
  }
  if (pathname === "/api/v1/assets/uploads") {
    return method === "POST" || method === "OPTIONS";
  }
  if (/^\/api\/v1\/assets\/uploads\/[^/]+\/complete$/.test(pathname)) {
    return method === "POST" || method === "OPTIONS";
  }
  if (/^\/api\/v1\/assets\/[^/]+(?:\/url)?$/.test(pathname)) {
    return method === "GET" || method === "OPTIONS";
  }
  const importMethods: Array<[RegExp, string]> = [
    [/^\/api\/v1\/migrations\/imports\/prepare$/, "POST"],
    [/^\/api\/v1\/migrations\/imports\/[^/]+$/, "GET"],
    [/^\/api\/v1\/migrations\/imports\/[^/]+\/(?:cancel|commit)$/, "POST"],
    [
      /^\/api\/v1\/migrations\/imports\/[^/]+\/assets\/[^/]+\/upload$/,
      method === "GET" ? "GET" : "POST",
    ],
    [
      /^\/api\/v1\/migrations\/imports\/[^/]+\/assets\/[^/]+\/(?:complete|cancel)$/,
      "POST",
    ],
    [
      /^\/api\/v1\/migrations\/imports\/[^/]+\/assets\/[^/]+\/parts\/[^/]+\/complete$/,
      "POST",
    ],
  ];
  if (
    importMethods.some(
      ([pattern, expected]) => pattern.test(pathname) && method === expected,
    )
  ) {
    return true;
  }
  const exportMethod =
    pathname.endsWith("/prepare") ||
    pathname.endsWith("/cancel") ||
    pathname.endsWith("/retry")
      ? "POST"
      : "GET";
  if (
    /^\/api\/v1\/projects\/[^/]+\/exports\/(?:prepare|[^/]+(?:\/download|\/cancel|\/retry)?)$/.test(
      pathname,
    ) &&
    method === exportMethod
  ) {
    return true;
  }
  if (
    (pathname.startsWith("/api/v1/migrations/") ||
      /^\/api\/v1\/projects\/[^/]+\/exports(?:\/|$)/.test(pathname)) &&
    method === "OPTIONS"
  ) {
    return true;
  }
  return (
    FASTIFY_OWNED_PATHS.has(pathname) ||
    /^\/api\/v1\/auth\/(?:sessions|devices)\/[^/]+$/.test(pathname) ||
    pathname.startsWith("/docs")
  );
}

export async function createFastifyApiServer(options: ServerOptions) {
  const logger =
    options.logger ??
    createJsonLogger({ level: options.config.logLevel, service: "api" });
  const metrics = options.metrics ?? createMetricsRegistry();
  const authService = options.authService ?? createUnavailableAuthService();
  const siteConfigService =
    options.siteConfigService ?? createUnavailablePublicSiteConfigService();
  const workspaceUsageService =
    options.workspaceUsageService ?? createUnavailableWorkspaceUsageService();
  const generationTelemetryService =
    options.generationTelemetryService ??
    createUnavailableGenerationTelemetryService();
  const assetService = options.assetService ?? createUnavailableAssetService();
  const migrationImportService =
    options.migrationImportService ?? createUnavailableMigrationImportService();
  const migrationAssetUploadService =
    options.migrationAssetUploadService ??
    createUnavailableMigrationAssetUploadService();
  const migrationExportService =
    options.migrationExportService ?? createUnavailableMigrationExportService();
  const legacyServer = createApiServer({
    ...options,
    authService,
    assetService,
    migrationAssetUploadService,
    migrationExportService,
    migrationImportService,
    generationTelemetryService,
    logger,
    metrics,
    siteConfigService,
    workspaceUsageService,
  });
  const legacyListener = legacyServer.listeners("request")[0] as
    RequestListener | undefined;
  if (!legacyListener) {
    throw new Error("Legacy API request handler is unavailable");
  }

  const app = Fastify<http.Server>({
    logger: false,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
      },
    },
    exposeHeadRoutes: false,
    requestIdHeader: false,
    genReqId: () => createRequestId(),
    trustProxy: options.config.trustProxy,
    serverFactory(fastifyHandler) {
      return http.createServer((request, response) => {
        if (isFastifyOwnedPath(request.url, request.method)) {
          fastifyHandler(request, response);
          return;
        }
        legacyListener(request, response);
      });
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  if (options.config.env === "development") {
    const { default: swagger } = await import("@fastify/swagger");
    await app.register(swagger, {
      openapi: {
        info: {
          title: "AI Canvas Cloud Public API",
          version: "0.1.0",
        },
      },
    });
  }

  const authContext = createFastifyAuthContextAdapter(authService);
  registerFastifyFoundation(app, {
    authContext,
    config: options.config,
    logger,
    metrics,
    rateLimiter: options.rateLimiter,
  });
  registerSystemRoutes(app, {
    metrics,
    siteConfigService,
    postgresPoolStats: options.postgresPoolStats,
    readinessChecks: options.readinessChecks,
  });
  registerWorkspaceRoutes(app, { authContext, workspaceUsageService });
  registerTelemetryRoutes(app, { authContext, generationTelemetryService });
  registerAuthRoutes(app, authContext);
  registerAssetRoutes(app, {
    assetCleanupService: options.assetCleanupService,
    assetService,
    authContext,
    config: options.config,
  });
  registerMigrationRoutes(app, {
    authContext,
    migrationAssetUploadService,
    migrationExportService,
    migrationImportService,
  });

  if (options.config.env === "development") {
    const { default: swaggerUi } = await import("@fastify/swagger-ui");
    await app.register(swaggerUi, {
      routePrefix: "/docs",
      staticCSP: true,
      uiConfig: { docExpansion: "list", deepLinking: false },
    });
  }

  await app.ready();
  const server = app.server as AdapterHttpServer;
  server[HTTP_ADAPTER_CLOSE] = async () => {
    await app.close();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
  return server;
}
