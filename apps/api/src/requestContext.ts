import type http from "node:http";
import { isIP } from "node:net";
import type {
  AuthRequestContext,
  AuthService,
} from "@ai-canvas-cloud/server/modules/auth";
import type { RateLimitBucket } from "./rateLimit.js";

export function getAuthContext(
  request: http.IncomingMessage,
  requestId: string,
): AuthRequestContext {
  return {
    requestId,
    userAgent: request.headers["user-agent"] ?? null,
    ipAddress: request.socket.remoteAddress ?? null,
    cookieHeader: request.headers.cookie ?? null,
  };
}

export function createRequestAuthService(
  authService: AuthService,
  requestId: string,
): AuthService {
  let sessionPromise: ReturnType<AuthService["getSession"]> | undefined;
  return {
    ...authService,
    getSession(context) {
      if (context.requestId !== requestId) {
        return authService.getSession(context);
      }
      sessionPromise ??= authService.getSession(context);
      return sessionPromise;
    },
  };
}

export async function getTrustedRateLimitScopes(
  request: http.IncomingMessage,
  requestId: string,
  authService: AuthService,
) {
  if (!request.headers.cookie?.trim()) {
    return [];
  }
  try {
    const session = await authService.getSession(
      getAuthContext(request, requestId),
    );
    return [`user:${session.user.id}`, `workspace:${session.workspace.id}`];
  } catch {
    return [];
  }
}

export function getRateLimitBucket(
  method: string | undefined,
  pathname: string,
): RateLimitBucket | null {
  const requestMethod = method ?? "GET";
  if (
    pathname === "/metrics" ||
    pathname === "/health/live" ||
    pathname === "/api/v1/health/live" ||
    pathname === "/health/ready" ||
    pathname === "/api/v1/health/ready" ||
    pathname === "/api/v1/site-config" ||
    pathname === "/docs" ||
    pathname.startsWith("/docs/") ||
    requestMethod === "OPTIONS"
  ) {
    return null;
  }
  if (
    pathname === "/api/v1/auth/login" ||
    pathname === "/api/v1/auth/register"
  ) {
    return "auth_attempt";
  }
  if (
    pathname.startsWith("/api/v1/auth/password/") ||
    pathname === "/api/v1/auth/registration/email-code"
  ) {
    return "password_email";
  }
  if (
    pathname === "/api/v1/migrations/imports/prepare" ||
    pathname.endsWith("/exports/prepare")
  ) {
    return "migration_prepare";
  }
  if (
    pathname.startsWith("/api/v1/assets/uploads") &&
    requestMethod === "POST"
  ) {
    return "asset_prepare";
  }
  return requestMethod === "GET" || requestMethod === "HEAD" ? "read" : "write";
}

export function getControlledNetworkIdentity(
  request: http.IncomingMessage,
  trustProxy: boolean,
) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded;
    const candidate = raw?.split(",").at(-1)?.trim();
    if (candidate && isIP(candidate)) {
      return candidate;
    }
  }
  const remoteAddress = request.socket.remoteAddress?.trim();
  return remoteAddress && isIP(remoteAddress)
    ? remoteAddress
    : "unknown-network";
}
