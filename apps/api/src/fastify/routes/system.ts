import type http from "node:http";
import { Type } from "@sinclair/typebox";
import {
  ApiErrorResponseSchema,
  HealthResponseSchema,
  PublicSiteConfigResponseSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { checkReadinessDependencies } from "../../dependencies.js";
import type { MetricsRegistry } from "@ai-canvas-cloud/shared";
import type { PublicSiteConfigService } from "@ai-canvas-cloud/server/modules/admin";

interface SystemRouteOptions {
  metrics: MetricsRegistry;
  siteConfigService: PublicSiteConfigService;
  postgresPoolStats?: () => { total: number; idle: number; waiting: number };
  readinessChecks?: {
    postgres?: () => Promise<void>;
    objectStorage?: () => Promise<void>;
    redis?: () => Promise<void>;
  };
}

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

const routeIds = new Set<string>();

function operation(operationId: string) {
  if (routeIds.has(operationId)) {
    throw new Error(`Duplicate Fastify operationId: ${operationId}`);
  }
  routeIds.add(operationId);
  return operationId;
}

function healthPayload(requestId: string, status: "ok" | "degraded") {
  return {
    status,
    service: "api",
    requestId,
    uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
  };
}

function registerLiveRoute(
  app: PublicFastifyInstance,
  url: string,
  operationId: string,
) {
  app.get(
    url,
    {
      schema: {
        operationId: operation(operationId),
        tags: ["system"],
        response: { 200: HealthResponseSchema },
      },
    },
    async (request) => healthPayload(request.id, "ok"),
  );
}

function registerReadyRoute(
  app: PublicFastifyInstance,
  url: string,
  operationId: string,
  options: SystemRouteOptions,
) {
  app.get(
    url,
    {
      schema: {
        operationId: operation(operationId),
        tags: ["system"],
        response: {
          200: HealthResponseSchema,
          503: HealthResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const dependencies = await checkReadinessDependencies(
        options.readinessChecks,
      );
      for (const [dependency, status] of Object.entries(dependencies)) {
        options.metrics.setGauge("dependency_up", status.ok ? 1 : 0, {
          dependency,
        });
      }
      const ok = Object.values(dependencies).every(
        (dependency) => dependency.ok,
      );
      return reply.code(ok ? 200 : 503).send({
        ...healthPayload(request.id, ok ? "ok" : "degraded"),
        dependencies,
      });
    },
  );
}

export function registerSystemRoutes(
  app: PublicFastifyInstance,
  options: SystemRouteOptions,
) {
  routeIds.clear();
  registerLiveRoute(app, "/health/live", "getSystemHealthLive");
  registerLiveRoute(app, "/api/v1/health/live", "getApiHealthLive");
  registerReadyRoute(app, "/health/ready", "getSystemHealthReady", options);
  registerReadyRoute(app, "/api/v1/health/ready", "getApiHealthReady", options);

  app.get(
    "/metrics",
    {
      schema: {
        operationId: operation("getPrometheusMetrics"),
        tags: ["system"],
        response: { 200: Type.String() },
      },
    },
    async (_request, reply) => {
      if (options.postgresPoolStats) {
        const pool = options.postgresPoolStats();
        options.metrics.setGauge("postgres_pool_connections", pool.total, {
          state: "total",
        });
        options.metrics.setGauge("postgres_pool_connections", pool.idle, {
          state: "idle",
        });
        options.metrics.setGauge("postgres_pool_connections", pool.waiting, {
          state: "waiting",
        });
      }
      return reply
        .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
        .send(options.metrics.renderPrometheus());
    },
  );

  app.get(
    "/api/v1/site-config",
    {
      schema: {
        operationId: operation("getPublicSiteConfig"),
        tags: ["system"],
        response: {
          200: PublicSiteConfigResponseSchema,
          304: Type.Null(),
          503: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const payload = await options.siteConfigService.getCurrent();
        reply.header("etag", payload.etag);
        reply.header("cache-control", "public, max-age=60, stale-if-error=300");
        if (request.headers["if-none-match"] === payload.etag) {
          return reply.code(304).send(null);
        }
        return reply.send(payload);
      } catch {
        return reply.code(503).send({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Site configuration is unavailable",
            retryable: true,
            requestId: request.id,
          },
        });
      }
    },
  );
}
