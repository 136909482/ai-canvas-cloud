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

const FASTIFY_OWNED_PATHS = new Set([
  "/metrics",
  "/health/live",
  "/health/ready",
  "/api/v1/health/live",
  "/api/v1/health/ready",
  "/api/v1/site-config",
  "/api/v1/workspaces/current",
  "/api/v1/workspaces/current/usage",
]);

function isFastifyOwnedPath(url: string | undefined) {
  const pathname = new URL(url ?? "/", "http://localhost").pathname;
  return FASTIFY_OWNED_PATHS.has(pathname) || pathname.startsWith("/docs");
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
  const legacyServer = createApiServer({
    ...options,
    authService,
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
    exposeHeadRoutes: false,
    requestIdHeader: false,
    genReqId: () => createRequestId(),
    trustProxy: options.config.trustProxy,
    serverFactory(fastifyHandler) {
      return http.createServer((request, response) => {
        if (isFastifyOwnedPath(request.url)) {
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
