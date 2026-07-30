import type http from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config.js";
import { handleSecurityBoundary } from "../security.js";
import { StrictJsonError, parseStrictJson } from "./strictJson.js";
import type { Logger, MetricsRegistry } from "@ai-canvas-cloud/shared";

function pathGroup(pathname: string) {
  if (pathname === "/metrics") return "/metrics";
  if (pathname.endsWith("/health/live")) return "/health/live";
  if (pathname.endsWith("/health/ready")) return "/health/ready";
  if (pathname.startsWith("/docs")) return "/docs";
  return "/unmatched";
}

function sendError(
  reply: FastifyReply,
  requestId: string,
  statusCode: number,
  code: "VALIDATION_FAILED" | "SERVICE_UNAVAILABLE",
  message: string,
) {
  return reply.code(statusCode).send({
    error: { code, message, retryable: statusCode >= 500, requestId },
  });
}

export function registerFastifyFoundation(
  app: FastifyInstance<
    http.Server,
    http.IncomingMessage,
    http.ServerResponse,
    FastifyBaseLogger,
    TypeBoxTypeProvider
  >,
  options: {
    config: ApiConfig;
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
        done(null, parseStrictJson(body as Buffer));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  app.addHook("onRequest", async (request, reply) => {
    const startedAt = performance.now();
    const pathname = new URL(request.raw.url ?? "/", "http://localhost")
      .pathname;
    const route = pathGroup(pathname);
    reply.raw.once("finish", () => {
      const statusClass = `${Math.floor(reply.raw.statusCode / 100)}xx`;
      options.metrics.increment("api_requests_total", 1, {
        method: request.method,
        route,
        status_class: statusClass,
      });
      options.metrics.observe(
        "api_request_duration_seconds",
        (performance.now() - startedAt) / 1_000,
        { route },
      );
      if (reply.raw.statusCode >= 400) {
        options.metrics.increment("api_errors_total", 1, {
          route,
          status_class: statusClass,
        });
      }
    });
    options.logger.info("request.received", {
      requestId: request.id,
      method: request.method,
      pathGroup: pathGroup(pathname),
      adapter: "fastify",
    });
    if (
      handleSecurityBoundary(request.raw, reply.raw, options.config, request.id)
    ) {
      reply.hijack();
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Route not found",
        retryable: true,
        requestId: request.id,
      },
    }),
  );

  app.setErrorHandler(async (error, request, reply) => {
    const fastifyError = error as Error & {
      code?: string;
      statusCode?: number;
      validation?: unknown;
    };
    if (
      error instanceof StrictJsonError ||
      fastifyError.validation ||
      fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE"
    ) {
      const tooLarge = fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE";
      return sendError(
        reply,
        request.id,
        tooLarge ? 413 : 400,
        "VALIDATION_FAILED",
        tooLarge ? "Request body is too large" : fastifyError.message,
      );
    }
    options.logger.error("request.failed", {
      requestId: request.id,
      error: fastifyError.name,
      errorCode: fastifyError.code,
    });
    return sendError(
      reply,
      request.id,
      500,
      "SERVICE_UNAVAILABLE",
      "Request failed",
    );
  });
}
