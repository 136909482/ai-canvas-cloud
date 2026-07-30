import { randomUUID } from "node:crypto";
import http from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import {
  createJsonLogger,
  createMetricsRegistry,
} from "@ai-canvas-cloud/shared";
import { createStaticSite } from "@ai-canvas-cloud/server";
import {
  createUnavailableAdminAssetCleanupService,
  createUnavailableAdminDashboardService,
  createUnavailableAdminObjectStorageConfigService,
  createUnavailableAdminSiteConfigService,
  createUnavailableAdminSmtpConfigService,
  createUnavailableAdminUserOperationsService,
} from "@ai-canvas-cloud/server/modules/admin";
import {
  ADMIN_HTTP_ADAPTER_CLOSE,
  type AdminAdapterHttpServer,
  type AdminServerOptions,
} from "../server.js";
import { resetAdminOperationIds } from "./helpers.js";
import { registerAdminFastifyFoundation } from "./plugins.js";
import { registerAdminAuthRoutes } from "./routes/auth.js";
import { registerAdminDashboardRoutes } from "./routes/dashboard.js";
import { registerAdminObjectStorageRoutes } from "./routes/objectStorage.js";
import { registerAdminSiteRoutes } from "./routes/site.js";
import { registerAdminSmtpRoutes } from "./routes/smtp.js";
import { registerAdminSystemRoutes } from "./routes/system.js";
import { registerAdminUserRoutes } from "./routes/users.js";

function isAdminApiOwnedPath(pathname: string) {
  return (
    pathname === "/metrics" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/health" ||
    pathname.startsWith("/health/") ||
    pathname.startsWith("/docs")
  );
}

function adminSiteContentSecurityPolicy(s3PublicOrigin: string) {
  const storageSource = s3PublicOrigin || "https:";
  return `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${storageSource}; font-src 'self' data:; connect-src 'self' ${storageSource}; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'`;
}

export async function createFastifyAdminApiServer(options: AdminServerOptions) {
  const logger =
    options.logger ??
    createJsonLogger({ level: options.config.logLevel, service: "admin-api" });
  const metrics = options.metrics ?? createMetricsRegistry();
  const dashboardService =
    options.dashboardService ?? createUnavailableAdminDashboardService();
  const siteConfigService =
    options.siteConfigService ?? createUnavailableAdminSiteConfigService();
  const smtpConfigService =
    options.smtpConfigService ?? createUnavailableAdminSmtpConfigService();
  const objectStorageConfigService =
    options.objectStorageConfigService ??
    createUnavailableAdminObjectStorageConfigService();
  const assetCleanupService =
    options.assetCleanupService ?? createUnavailableAdminAssetCleanupService();
  const userOperationsService =
    options.userOperationsService ??
    createUnavailableAdminUserOperationsService();
  const staticSite = options.config.staticSiteRoot
    ? createStaticSite({
        root: options.config.staticSiteRoot,
        contentSecurityPolicy: adminSiteContentSecurityPolicy(
          options.config.s3PublicOrigin,
        ),
        environment: options.config.env,
      })
    : undefined;

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
    genReqId: () => randomUUID(),
    trustProxy: options.config.trustProxy,
  }).withTypeProvider<TypeBoxTypeProvider>();

  if (options.config.env === "development") {
    const { default: swagger } = await import("@fastify/swagger");
    await app.register(swagger, {
      openapi: {
        info: {
          title: "AI Canvas Cloud Admin API",
          version: "0.1.0",
        },
      },
    });
  }

  resetAdminOperationIds();
  registerAdminFastifyFoundation(app, {
    config: options.config,
    logger,
    metrics,
  });
  registerAdminSystemRoutes(app, {
    metrics,
    readinessChecks: options.readinessChecks,
  });
  registerAdminAuthRoutes(app, {
    config: options.config,
    adminService: options.adminService,
  });
  registerAdminDashboardRoutes(app, {
    config: options.config,
    adminService: options.adminService,
    dashboardService,
  });
  registerAdminUserRoutes(app, {
    config: options.config,
    userOperationsService,
  });
  registerAdminSiteRoutes(app, { config: options.config, siteConfigService });
  registerAdminSmtpRoutes(app, { config: options.config, smtpConfigService });
  registerAdminObjectStorageRoutes(app, {
    config: options.config,
    objectStorageConfigService,
    assetCleanupService,
  });

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = new URL(request.raw.url ?? "/", "http://localhost")
      .pathname;
    if (staticSite && !isAdminApiOwnedPath(pathname)) {
      reply.hijack();
      await staticSite.handle(request.raw, reply.raw, pathname);
      return;
    }
    return reply.code(404).send({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Route not found",
        retryable: false,
        requestId: request.id,
      },
    });
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
  const server = app.server as AdminAdapterHttpServer;
  server[ADMIN_HTTP_ADAPTER_CLOSE] = async () => {
    await app.close();
  };
  return server;
}
