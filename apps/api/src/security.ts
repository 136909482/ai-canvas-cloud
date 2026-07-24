import type http from "node:http";
import type { ApiConfig } from "./config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "content-type, x-request-id";

function sendOriginDenied(response: http.ServerResponse, requestId: string) {
  response.statusCode = 403;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-request-id", requestId);
  response.end(
    JSON.stringify({
      error: {
        code: "ACCESS_DENIED",
        message: "Origin is not allowed",
        retryable: false,
        requestId,
      },
    }),
  );
}

function sendCsrfDenied(
  response: http.ServerResponse,
  requestId: string,
  message: string,
) {
  response.statusCode = 403;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-request-id", requestId);
  response.end(
    JSON.stringify({
      error: {
        code: "ACCESS_DENIED",
        message,
        retryable: false,
        requestId,
      },
    }),
  );
}

export function applySecurityHeaders(
  response: http.ServerResponse,
  env: string,
) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-site");
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  if (env === "production" || env === "staging") {
    response.setHeader(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }
}

export function handleSecurityBoundary(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: Pick<ApiConfig, "env" | "webAllowedOrigins">,
  requestId: string,
) {
  applySecurityHeaders(response, config.env);

  const origin = request.headers.origin;
  const isAllowedOrigin =
    typeof origin === "string" && config.webAllowedOrigins.includes(origin);
  if (origin) {
    response.setHeader("vary", "Origin");
    if (!isAllowedOrigin) {
      sendOriginDenied(response, requestId);
      return true;
    }
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-credentials", "true");
  }

  if (request.method === "OPTIONS") {
    if (origin && !isAllowedOrigin) {
      return true;
    }
    response.statusCode = 204;
    response.setHeader("access-control-allow-methods", ALLOWED_METHODS);
    response.setHeader("access-control-allow-headers", ALLOWED_HEADERS);
    response.setHeader("access-control-max-age", "600");
    response.end();
    return true;
  }

  const method = request.method ?? "GET";
  if (
    !SAFE_METHODS.has(method) &&
    (config.env === "production" || config.env === "staging")
  ) {
    const fetchSite = request.headers["sec-fetch-site"];
    if (fetchSite === "cross-site") {
      sendCsrfDenied(
        response,
        requestId,
        "Cross-site requests are not allowed",
      );
      return true;
    }

    const hasCookie =
      typeof request.headers.cookie === "string" &&
      request.headers.cookie.trim().length > 0;
    const isAuthCookieWrite = request.url?.startsWith("/api/v1/auth/") ?? false;
    if ((hasCookie || isAuthCookieWrite) && !origin) {
      sendCsrfDenied(
        response,
        requestId,
        "Cookie writes require an allowed Origin",
      );
      return true;
    }
  }

  return false;
}
