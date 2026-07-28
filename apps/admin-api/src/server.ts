import { randomUUID } from "node:crypto";
import http from "node:http";
import type {
  CreateSiteAssetRequest,
  PublishSiteConfigRequest,
} from "@ai-canvas-cloud/contracts";
import {
  createMetricsRegistry,
  hasDuplicateJsonObjectKeys,
  type Logger,
  type MeasuredDependencyStatus,
  type MetricsRegistry,
} from "@ai-canvas-cloud/shared";
import {
  AdminAccessError,
  createUnavailableAdminDashboardService,
  createUnavailableAdminSiteConfigService,
  createUnavailableAdminSmtpConfigService,
  createUnavailableAdminObjectStorageConfigService,
  createUnavailableAdminUserOperationsService,
  type AdminRequestContext,
  type AdminDashboardService,
  type AdminService,
  type AdminSiteConfigService,
  type AdminSmtpConfigService,
  type AdminObjectStorageConfigService,
  type AdminUserOperationsService,
} from "@ai-canvas-cloud/server/modules/admin";
import type { AdminApiConfig } from "./config.js";
import {
  clearCsrfCookie,
  createCsrfCookie,
  createCsrfToken,
  getAdminClientIp,
  handleAdminSecurityBoundary,
} from "./security.js";

interface AdminServerOptions {
  config: AdminApiConfig;
  adminService: AdminService;
  dashboardService?: AdminDashboardService;
  siteConfigService?: AdminSiteConfigService;
  smtpConfigService?: AdminSmtpConfigService;
  objectStorageConfigService?: AdminObjectStorageConfigService;
  userOperationsService?: AdminUserOperationsService;
  logger: Logger;
  metrics?: MetricsRegistry;
  readinessChecks?: {
    postgres?: () => Promise<MeasuredDependencyStatus>;
    objectStorage?: () => Promise<MeasuredDependencyStatus>;
  };
}

function sendMetrics(
  response: http.ServerResponse,
  payload: string,
  requestId: string,
) {
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    "text/plain; version=0.0.4; charset=utf-8",
  );
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-request-id", requestId);
  response.end(payload);
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  payload: unknown,
  requestId: string,
) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-request-id", requestId);
  response.end(JSON.stringify(payload));
}

function appendCookies(response: http.ServerResponse, cookies: string[]) {
  if (cookies.length > 0) response.setHeader("set-cookie", cookies);
}

async function readJson(request: http.IncomingMessage, maxBytes = 16 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes)
      throw new AdminAccessError(
        413,
        "VALIDATION_FAILED",
        "Request body is too large",
      );
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text || hasDuplicateJsonObjectKeys(text))
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "JSON body is invalid",
    );
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "JSON body is invalid",
    );
  }
}

function stringField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "string")
    throw new AdminAccessError(400, "VALIDATION_FAILED", `${key} is required`);
  return value;
}

function optionalStringField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      `${key} must be a string`,
    );
  return value;
}

function booleanField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "boolean")
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      `${key} must be a boolean`,
    );
  return value;
}

function requestContext(
  request: http.IncomingMessage,
  config: AdminApiConfig,
  requestId: string,
): AdminRequestContext {
  return {
    requestId,
    cookieHeader: request.headers.cookie,
    ipAddress: getAdminClientIp(request, config.trustProxy),
    userAgent: request.headers["user-agent"],
  };
}

function queryDocument(searchParams: URLSearchParams) {
  const output: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(output, key))
      throw new AdminAccessError(
        400,
        "VALIDATION_FAILED",
        `Duplicate query parameter: ${key}`,
      );
    output[key] = value;
  }
  return output;
}

function adminPathGroup(pathname: string) {
  return pathname
    .replace(/^\/admin\/v1\/users\/[^/]+/, "/admin/v1/users/:id")
    .replace(/[0-9a-f-]{36}/gi, ":id");
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Path parameter is invalid",
    );
  }
}

function sendError(
  response: http.ServerResponse,
  error: unknown,
  requestId: string,
) {
  const mapped =
    error instanceof AdminAccessError
      ? error
      : new AdminAccessError(
          500,
          "SERVICE_UNAVAILABLE",
          "Administrator request failed",
        );
  sendJson(
    response,
    mapped.statusCode,
    {
      error: {
        code: mapped.code,
        message: mapped.message,
        retryable: mapped.statusCode >= 500,
        requestId,
      },
    },
    requestId,
  );
}

export function createAdminApiServer({
  config,
  adminService,
  dashboardService = createUnavailableAdminDashboardService(),
  siteConfigService = createUnavailableAdminSiteConfigService(),
  smtpConfigService = createUnavailableAdminSmtpConfigService(),
  objectStorageConfigService = createUnavailableAdminObjectStorageConfigService(),
  userOperationsService = createUnavailableAdminUserOperationsService(),
  logger,
  metrics = createMetricsRegistry(),
  readinessChecks,
}: AdminServerOptions) {
  return http.createServer(async (request, response) => {
    const requestId = randomUUID();
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    logger.info("request.received", {
      requestId,
      method: request.method,
      pathGroup: adminPathGroup(url.pathname),
    });
    if (handleAdminSecurityBoundary(request, response, config, requestId))
      return;
    try {
      if (url.pathname === "/metrics" && request.method === "GET") {
        sendMetrics(response, metrics.renderPrometheus(), requestId);
        return;
      }
      if (url.pathname === "/health/live" && request.method === "GET") {
        sendJson(
          response,
          200,
          {
            status: "ok",
            service: "admin-api",
            requestId,
            checkedAt: new Date().toISOString(),
          },
          requestId,
        );
        return;
      }
      if (url.pathname === "/health/ready" && request.method === "GET") {
        try {
          if (!readinessChecks?.postgres || !readinessChecks.objectStorage)
            throw new Error();
          const [postgres, objectStorage] = await Promise.all([
            readinessChecks.postgres(),
            readinessChecks.objectStorage(),
          ]);
          const ok = postgres.ok && objectStorage.ok;
          sendJson(
            response,
            ok ? 200 : 503,
            {
              status: ok ? "ok" : "degraded",
              service: "admin-api",
              requestId,
              dependencies: { postgres, objectStorage },
              checkedAt: new Date().toISOString(),
            },
            requestId,
          );
        } catch {
          sendJson(
            response,
            503,
            {
              status: "degraded",
              service: "admin-api",
              requestId,
              dependencies: {
                postgres: { ok: false, latencyMs: 0, error: "unknown" },
                objectStorage: { ok: false, latencyMs: 0, error: "unknown" },
              },
              checkedAt: new Date().toISOString(),
            },
            requestId,
          );
        }
        return;
      }
      if (url.pathname === "/admin/v1/auth/csrf" && request.method === "GET") {
        const token = createCsrfToken(config.betterAuthSecret);
        appendCookies(response, [createCsrfCookie(token, config)]);
        sendJson(response, 200, { token }, requestId);
        return;
      }
      const context = requestContext(request, config, requestId);
      if (
        url.pathname === "/admin/v1/auth/captcha" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          await adminService.createLoginCaptcha(),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/auth/login" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        const result = await adminService.login(
          {
            username: stringField(body, "username"),
            password: stringField(body, "password"),
            captchaChallengeId: optionalStringField(body, "captchaChallengeId"),
            captchaCode: optionalStringField(body, "captchaCode"),
          },
          context,
        );
        appendCookies(response, result.setCookieHeaders);
        sendJson(response, 200, result.response, requestId);
        return;
      }
      if (
        url.pathname === "/admin/v1/auth/session" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          await adminService.getSession(context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/auth/username" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await adminService.updateUsername(
            { username: stringField(body, "username") },
            context,
          ),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/auth/password" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        const result = await adminService.changePassword(
          {
            currentPassword: stringField(body, "currentPassword"),
            newPassword: stringField(body, "newPassword"),
          },
          context,
        );
        appendCookies(response, result.setCookieHeaders);
        sendJson(response, 200, result.response, requestId);
        return;
      }
      if (
        url.pathname === "/admin/v1/auth/login-security" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          await adminService.getLoginSecuritySettings(context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/auth/login-security" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await adminService.updateLoginSecuritySettings(
            {
              captchaEnabled: booleanField(body, "captchaEnabled"),
            },
            context,
          ),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/auth/logout" &&
        request.method === "POST"
      ) {
        const result = await adminService.logout(context);
        appendCookies(response, [
          ...result.setCookieHeaders,
          clearCsrfCookie(config),
        ]);
        sendJson(response, 200, result.response, requestId);
        return;
      }
      if (
        url.pathname === "/admin/v1/audit-events" &&
        request.method === "GET"
      ) {
        const limitValue = url.searchParams.get("limit");
        const resultValue = url.searchParams.get("result");
        const result =
          resultValue === "success" || resultValue === "failure"
            ? resultValue
            : undefined;
        sendJson(
          response,
          200,
          await adminService.listAuditEvents(
            {
              cursor: url.searchParams.get("cursor") ?? undefined,
              action: url.searchParams.get("action") ?? undefined,
              result,
              limit: limitValue === null ? undefined : Number(limitValue),
            },
            context,
          ),
          requestId,
        );
        return;
      }
      if (url.pathname === "/admin/v1/dashboard" && request.method === "GET") {
        sendJson(
          response,
          200,
          await dashboardService.getDashboard(context),
          requestId,
        );
        return;
      }
      if (url.pathname === "/admin/v1/users" && request.method === "GET") {
        sendJson(
          response,
          200,
          await userOperationsService.listUsers(
            queryDocument(url.searchParams),
            context,
          ),
          requestId,
        );
        return;
      }
      const userDetail = /^\/admin\/v1\/users\/([^/]+)$/.exec(url.pathname);
      if (userDetail && request.method === "GET") {
        sendJson(
          response,
          200,
          await userOperationsService.getUser(
            decodePathSegment(userDetail[1]!),
            context,
          ),
          requestId,
        );
        return;
      }
      const userAction =
        /^\/admin\/v1\/users\/([^/]+)\/(ban|unban|revoke-sessions)$/.exec(
          url.pathname,
        );
      if (userAction && request.method === "POST") {
        const userId = decodePathSegment(userAction[1]!);
        const body = await readJson(request);
        const action = userAction[2];
        const payload =
          action === "ban"
            ? await userOperationsService.banUser(userId, body, context)
            : action === "unban"
              ? await userOperationsService.unbanUser(userId, body, context)
              : await userOperationsService.revokeUserSessions(
                  userId,
                  body,
                  context,
                );
        sendJson(response, 200, payload, requestId);
        return;
      }
      if (
        url.pathname === "/admin/v1/object-storage-settings" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          await objectStorageConfigService.getCurrent(context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/object-storage-settings/test-connection" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await objectStorageConfigService.testConnection(
            body as never,
            context,
          ),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/object-storage-settings" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await objectStorageConfigService.publish(body as never, context),
          requestId,
        );
        return;
      }
      if (
        url.pathname ===
          "/admin/v1/object-storage-settings/restore-environment" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await objectStorageConfigService.restoreEnvironment(
            body as never,
            context,
          ),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/smtp-settings" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          await smtpConfigService.getCurrent(context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/smtp-settings/test-connection" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await smtpConfigService.testConnection(body as never, context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/smtp-settings/test-email" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await smtpConfigService.testEmail(body as never, context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/smtp-settings" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await smtpConfigService.publish(body as never, context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/smtp-settings/disable" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await smtpConfigService.disable(body as never, context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/site-config" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          await siteConfigService.getCurrent(context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/site-config" &&
        request.method === "POST"
      ) {
        const body = await readJson(request, 32 * 1024);
        sendJson(
          response,
          200,
          await siteConfigService.publish(
            body as unknown as PublishSiteConfigRequest,
            context,
          ),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/site-assets" &&
        request.method === "GET"
      ) {
        sendJson(
          response,
          200,
          await siteConfigService.listAssets(context),
          requestId,
        );
        return;
      }
      if (
        url.pathname === "/admin/v1/site-assets" &&
        request.method === "POST"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          201,
          await siteConfigService.createAsset(
            body as unknown as CreateSiteAssetRequest,
            context,
          ),
          requestId,
        );
        return;
      }
      const siteAssetCompletion =
        /^\/admin\/v1\/site-assets\/([0-9a-f-]{36})\/complete$/i.exec(
          url.pathname,
        );
      if (siteAssetCompletion && request.method === "POST") {
        sendJson(
          response,
          200,
          await siteConfigService.completeAsset(
            siteAssetCompletion[1]!,
            context,
          ),
          requestId,
        );
        return;
      }
      sendJson(
        response,
        404,
        {
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: "Route not found",
            retryable: false,
            requestId,
          },
        },
        requestId,
      );
    } catch (error) {
      logger.warn("request.rejected", {
        requestId,
        error:
          error instanceof AdminAccessError
            ? error.code
            : "SERVICE_UNAVAILABLE",
      });
      sendError(response, error, requestId);
    }
  });
}

export async function closeAdminApiServer(
  server: http.Server,
  timeoutMs: number,
) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out closing Admin API server")),
      timeoutMs,
    );
    server.close((error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    });
  });
}
