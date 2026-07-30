import type http from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config.js";
import type { RateLimitDecision, RateLimiter } from "../rateLimit.js";
import {
  getControlledNetworkIdentity,
  getRateLimitBucket,
} from "../requestContext.js";
import { handleSecurityBoundary } from "../security.js";
import type { FastifyAuthContextAdapter } from "./authContext.js";
import { StrictJsonError, parseStrictJson } from "./strictJson.js";
import type { Logger, MetricsRegistry } from "@ai-canvas-cloud/shared";

const API_ROUTE_GROUPS = new Set([
  "account",
  "assets",
  "auth",
  "migrations",
  "models",
  "projects",
  "settings",
  "tasks",
  "telemetry",
  "workspaces",
]);

function pathGroup(pathname: string) {
  if (pathname === "/metrics") return "/metrics";
  if (pathname === "/internal/v1/asset-cleanup")
    return "/internal/v1/asset-cleanup";
  if (pathname.endsWith("/health/live")) return "/health/live";
  if (pathname.endsWith("/health/ready")) return "/health/ready";
  if (pathname.startsWith("/docs")) return "/docs";
  const match = pathname.match(/^\/api\/v1\/([a-z-]+)(?:\/|$)/);
  if (match?.[1] && API_ROUTE_GROUPS.has(match[1])) {
    return `/api/v1/${match[1]}`;
  }
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

function sendRateLimitError(
  reply: FastifyReply,
  requestId: string,
  decision: RateLimitDecision,
) {
  const retryAfterSeconds = Math.max(1, decision.retryAfterSeconds);
  reply.header("retry-after", String(retryAfterSeconds));
  if (!decision.available) {
    return reply.code(503).send({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Rate limiting service is unavailable",
        retryable: true,
        requestId,
        details: {
          dependency: "redis",
          failureMode: "closed",
          bucket: decision.bucket,
        },
      },
    });
  }
  return reply.code(429).send({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryable: true,
      requestId,
      details: { retryAfterSeconds },
    },
  });
}

function strictJsonResponseMessage(error: StrictJsonError) {
  if (
    error.message === "Request body is required" ||
    error.message === "Request body must use valid UTF-8 JSON"
  ) {
    return error.message;
  }
  return "Request body must be valid JSON";
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
    authContext: FastifyAuthContextAdapter;
    config: ApiConfig;
    logger: Logger;
    metrics: MetricsRegistry;
    rateLimiter?: RateLimiter;
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
      if (reply.raw.statusCode === 401 || reply.raw.statusCode === 403) {
        options.metrics.increment("api_auth_failures_total", 1, {
          route,
          status_class: statusClass,
        });
      }
      if (reply.raw.statusCode === 429) {
        options.metrics.increment("api_rate_limited_total", 1, { route });
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
      return;
    }
    if (options.rateLimiter) {
      const bucket = getRateLimitBucket(request.method, pathname);
      if (!bucket) return;
      const networkDecision = await options.rateLimiter.consume(bucket, [
        `ip:${getControlledNetworkIdentity(request.raw, options.config.trustProxy)}`,
      ]);
      if (!networkDecision.allowed) {
        await sendRateLimitError(reply, request.id, networkDecision);
        return;
      }
      if (bucket === "auth_attempt") return;
      const trustedScopes =
        await options.authContext.getTrustedRateLimitScopes(request);
      if (trustedScopes.length === 0) return;
      const identityDecision = await options.rateLimiter.consume(
        bucket,
        trustedScopes,
      );
      if (!identityDecision.allowed) {
        await sendRateLimitError(reply, request.id, identityDecision);
      }
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
        tooLarge
          ? "Request body is too large"
          : error instanceof StrictJsonError
            ? strictJsonResponseMessage(error)
            : fastifyError.message,
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
