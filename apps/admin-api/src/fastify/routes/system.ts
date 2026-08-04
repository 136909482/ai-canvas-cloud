import { Type } from "@sinclair/typebox";
import {
  AdminErrorResponseSchema,
  AdminHealthResponseSchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type {
  MeasuredDependencyStatus,
  MetricsRegistry,
} from "@ai-canvas-cloud/shared";
import { adminOperation } from "../helpers.js";
import type { AdminFastifyInstance } from "../types.js";

interface SystemRouteOptions {
  metrics: MetricsRegistry;
  exposeMetrics?: boolean;
  readinessChecks?: {
    postgres?: () => Promise<MeasuredDependencyStatus>;
    objectStorage?: () => Promise<MeasuredDependencyStatus>;
  };
}

function livePayload(requestId: string) {
  return {
    status: "ok" as const,
    service: "admin-api" as const,
    requestId,
    checkedAt: new Date().toISOString(),
  };
}

export function registerAdminSystemRoutes(
  app: AdminFastifyInstance,
  options: SystemRouteOptions,
) {
  if (options.exposeMetrics !== false) {
    app.get(
      "/metrics",
      {
        schema: {
          operationId: adminOperation("getAdminPrometheusMetrics"),
          tags: ["system"],
          response: { 200: Type.String() },
        },
      },
      async (_request, reply) =>
        reply
          .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
          .send(options.metrics.renderPrometheus()),
    );
  }

  app.get(
    "/health/live",
    {
      schema: {
        operationId: adminOperation("getAdminHealthLive"),
        tags: ["system"],
        response: { 200: AdminHealthResponseSchema },
      },
    },
    async (request) => livePayload(request.id),
  );

  app.get(
    "/health/ready",
    {
      schema: {
        operationId: adminOperation("getAdminHealthReady"),
        tags: ["system"],
        response: {
          200: AdminHealthResponseSchema,
          503: AdminHealthResponseSchema,
          500: AdminErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      let postgres: MeasuredDependencyStatus;
      let objectStorage: MeasuredDependencyStatus;
      try {
        if (
          !options.readinessChecks?.postgres ||
          !options.readinessChecks.objectStorage
        ) {
          throw new Error();
        }
        [postgres, objectStorage] = await Promise.all([
          options.readinessChecks.postgres(),
          options.readinessChecks.objectStorage(),
        ]);
      } catch {
        postgres = { ok: false, latencyMs: 0, error: "unknown" };
        objectStorage = { ok: false, latencyMs: 0, error: "unknown" };
      }
      const ok = postgres.ok && objectStorage.ok;
      return reply.code(ok ? 200 : 503).send({
        status: ok ? "ok" : "degraded",
        service: "admin-api",
        requestId: request.id,
        dependencies: { postgres, objectStorage },
        checkedAt: new Date().toISOString(),
      });
    },
  );
}
