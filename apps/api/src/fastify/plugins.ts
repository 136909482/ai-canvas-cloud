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
import { PUBLIC_ROUTE_INVENTORY } from "../routeInventory.js";
import type { FastifyAuthContextAdapter } from "./authContext.js";
import { sendAuthError } from "./reply.js";
import { StrictJsonError, parseStrictJson } from "./strictJson.js";
import type { Logger, MetricsRegistry } from "@ai-canvas-cloud/shared";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";

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
  "announcements",
]);

const SESSION_PROTECTED_ROUTE_GROUPS = new Set([
  "assets",
  "migrations",
  "projects",
  "telemetry",
  "workspaces",
  "announcements",
]);
const SESSION_PROTECTED_PATHS = PUBLIC_ROUTE_INVENTORY.filter((route) =>
  SESSION_PROTECTED_ROUTE_GROUPS.has(route.group),
).map((route) => ({ group: route.group, segments: route.path.split("/") }));

function getKnownSessionProtectedGroup(pathname: string) {
  const segments = pathname.split("/");
  return SESSION_PROTECTED_PATHS.find(
    (route) =>
      route.segments.length === segments.length &&
      route.segments.every(
        (segment, index) =>
          (segment.startsWith(":") && segments[index]?.length !== 0) ||
          segment === segments[index],
      ),
  )?.group;
}

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

function migrationPhase(pathname: string) {
  const isImport = pathname.startsWith("/api/v1/migrations/");
  const isExport = /^\/api\/v1\/projects\/[^/]+\/exports(?:\/|$)/.test(
    pathname,
  );
  if (!isImport && !isExport) return null;
  if (pathname.endsWith("/prepare"))
    return isExport ? "export_prepare" : "import_prepare";
  if (pathname.endsWith("/commit")) return "import_commit";
  if (pathname.endsWith("/download")) return "export_download";
  if (pathname.endsWith("/retry")) return "export_retry";
  if (pathname.endsWith("/cancel")) return "cancel";
  if (pathname.includes("/assets/")) return "asset_upload";
  return isExport ? "export_status" : "import_status";
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
    staticSite?: {
      handle: (
        request: http.IncomingMessage,
        response: http.ServerResponse,
        pathname: string,
      ) => Promise<boolean>;
    };
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
      const phase = migrationPhase(pathname);
      if (phase) {
        options.metrics.increment("migration_operations_total", 1, {
          phase,
          outcome: reply.raw.statusCode < 400 ? "success" : "failure",
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

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = new URL(request.raw.url ?? "/", "http://localhost")
      .pathname;
    const apiOwned =
      pathname === "/metrics" ||
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/internal" ||
      pathname.startsWith("/internal/") ||
      pathname === "/health" ||
      pathname.startsWith("/health/") ||
      pathname.startsWith("/docs");
    const protectedGroup = getKnownSessionProtectedGroup(pathname);
    if (protectedGroup) {
      try {
        if (
          protectedGroup === "migrations" &&
          /^\/api\/v1\/projects\/[^/]+\/exports(?:\/|$)/.test(pathname)
        ) {
          await options.authContext
            .getService(request)
            .getSession(options.authContext.getContext(request));
        } else {
          await options.authContext.requireSession(request);
        }
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return sendAuthError(reply, request.id, error);
        }
        throw error;
      }
      return reply.code(404).send({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Route not found",
          retryable: false,
          requestId: request.id,
        },
      });
    }
    if (options.staticSite && !apiOwned) {
      reply.hijack();
      await options.staticSite.handle(request.raw, reply.raw, pathname);
      return;
    }
    return reply.code(404).send({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Route not found",
        retryable: true,
        requestId: request.id,
      },
    });
  });

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
