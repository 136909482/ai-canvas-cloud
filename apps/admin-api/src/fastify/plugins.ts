import { AdminErrorResponseSchema } from "@ai-canvas-cloud/contracts/admin-http-schema";
import { AdminAccessError } from "@ai-canvas-cloud/server/modules/admin";
import type { Logger, MetricsRegistry } from "@ai-canvas-cloud/shared";
import type { AdminApiConfig } from "../config.js";
import { handleAdminSecurityBoundary } from "../security.js";
import type { AdminFastifyInstance } from "./types.js";
import { AdminStrictJsonError, parseAdminStrictJson } from "./strictJson.js";

function adminPathGroup(pathname: string) {
  return pathname
    .replace(/^\/admin\/v1\/users\/[^/]+/, "/admin/v1/users/:id")
    .replace(/[0-9a-f-]{36}/gi, ":id");
}

export function registerAdminFastifyFoundation(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    logger: Logger;
    metrics: MetricsRegistry;
  },
) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;.*)?$/i,
    { parseAs: "buffer" },
    (_request, body, done) => {
      try {
        done(null, parseAdminStrictJson(body as Buffer));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  app.addHook("onRequest", async (request, reply) => {
    const startedAt = performance.now();
    const pathname = new URL(request.raw.url ?? "/", "http://localhost")
      .pathname;
    const route = adminPathGroup(pathname);
    reply.raw.once("finish", () => {
      const statusClass = `${Math.floor(reply.raw.statusCode / 100)}xx`;
      options.metrics.increment("admin_api_requests_total", 1, {
        method: request.method,
        route,
        status_class: statusClass,
      });
      options.metrics.observe(
        "admin_api_request_duration_seconds",
        (performance.now() - startedAt) / 1_000,
        { route },
      );
    });
    options.logger.info("request.received", {
      requestId: request.id,
      method: request.method,
      pathGroup: route,
      adapter: "fastify",
    });
    if (
      handleAdminSecurityBoundary(
        request.raw,
        reply.raw,
        options.config,
        request.id,
      )
    ) {
      reply.hijack();
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    if (!reply.hasHeader("cache-control"))
      reply.header("cache-control", "no-store");
    return payload;
  });

  app.setErrorHandler(async (error, request, reply) => {
    const fastifyError = error as Error & {
      code?: string;
      validation?: unknown;
    };
    const mapped =
      error instanceof AdminAccessError
        ? error
        : error instanceof AdminStrictJsonError ||
            fastifyError.validation ||
            fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? new AdminAccessError(
              fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? 413 : 400,
              "VALIDATION_FAILED",
              fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE"
                ? "Request body is too large"
                : "JSON body is invalid",
            )
          : new AdminAccessError(
              500,
              "SERVICE_UNAVAILABLE",
              "Administrator request failed",
            );
    options.logger.warn("request.rejected", {
      requestId: request.id,
      error: mapped.code,
    });
    return reply.code(mapped.statusCode).send({
      error: {
        code: mapped.code,
        message: mapped.message,
        retryable: mapped.statusCode >= 500,
        requestId: request.id,
      },
    });
  });

  void AdminErrorResponseSchema;
}
