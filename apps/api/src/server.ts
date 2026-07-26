import http from "node:http";
import { isIP } from "node:net";
import {
  API_V1_PREFIX,
  createServiceUnavailableError,
  type ApiErrorResponse,
  type ApplyProjectGraphOperationsRequest,
  type AuthDevicesResponse,
  type AuthSessionsResponse,
  type CreateAssetUploadRequest,
  type CreateProjectCheckpointRequest,
  type CurrentWorkspaceResponse,
  type EmailVerificationResponse,
  type EmailVerifyRequest,
  type GenerationTelemetryRequest,
  type HealthResponse,
  type LoginRequest,
  type LogoutResponse,
  type PasswordForgotRequest,
  type PasswordResetRequest,
  type PasswordResetResponse,
  type CreateProjectRequest,
  type ProjectListStatus,
  type RenameProjectRequest,
  type RegisterRequest,
  type RemoveDeviceResponse,
  type RestoreProjectRevisionRequest,
  type RevokeSessionResponse,
} from "@ai-canvas-cloud/contracts";
import {
  createUnavailableAssetService,
  type AssetService,
} from "@ai-canvas-cloud/server/modules/assets";
import {
  AuthServiceError,
  createUnavailableAuthService,
  type AuthRequestContext,
  type AuthService,
} from "@ai-canvas-cloud/server/modules/auth";
import {
  createUnavailableGenerationTelemetryService,
  type GenerationTelemetryService,
} from "@ai-canvas-cloud/server/modules/generation-telemetry";
import {
  createUnavailableProjectGraphService,
  validateProjectGraphChangesAfter,
  type ProjectGraphService,
} from "@ai-canvas-cloud/server/modules/project-graph";
import {
  createUnavailableMigrationImportService,
  createUnavailableMigrationAssetUploadService,
  createUnavailableMigrationExportService,
  type MigrationAssetUploadService,
  type MigrationExportService,
  type MigrationImportService,
} from "@ai-canvas-cloud/server/modules/migrations";
import {
  createUnavailableProjectSnapshotService,
  type ProjectSnapshotService,
} from "@ai-canvas-cloud/server/modules/project-snapshots";
import {
  createUnavailableProjectService,
  type ProjectService,
} from "@ai-canvas-cloud/server/modules/projects";
import {
  createUnavailableWorkspaceUsageService,
  type WorkspaceUsageService,
} from "@ai-canvas-cloud/server/modules/workspaces";
import {
  createUnavailablePublicSiteConfigService,
  type PublicSiteConfigService,
} from "@ai-canvas-cloud/server/modules/admin";
import {
  createJsonLogger,
  createMetricsRegistry,
  createRequestId,
  hasDuplicateJsonObjectKeys,
  type Logger,
  type MetricsRegistry,
} from "@ai-canvas-cloud/shared";
import type { ApiConfig } from "./config.js";
import { checkReadinessDependencies } from "./dependencies.js";
import type {
  RateLimitBucket,
  RateLimiter,
  RateLimitDecision,
} from "./rateLimit.js";
import { handleSecurityBoundary } from "./security.js";

interface ServerOptions {
  config: ApiConfig;
  logger?: Logger;
  authService?: AuthService;
  generationTelemetryService?: GenerationTelemetryService;
  assetService?: AssetService;
  projectGraphService?: ProjectGraphService;
  projectSnapshotService?: ProjectSnapshotService;
  projectService?: ProjectService;
  workspaceUsageService?: WorkspaceUsageService;
  migrationImportService?: MigrationImportService;
  migrationAssetUploadService?: MigrationAssetUploadService;
  migrationExportService?: MigrationExportService;
  siteConfigService?: PublicSiteConfigService;
  metrics?: MetricsRegistry;
  postgresPoolStats?: () => { total: number; idle: number; waiting: number };
  readinessChecks?: {
    postgres?: () => Promise<void>;
    objectStorage?: () => Promise<void>;
    redis?: () => Promise<void>;
  };
  rateLimiter?: RateLimiter;
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  requestId: string,
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-request-id", requestId);
  response.end(JSON.stringify(payload));
}

const API_ERROR_CODE = Symbol("apiErrorCode");

function sendApiError(
  response: http.ServerResponse,
  statusCode: number,
  error: ApiErrorResponse,
  requestId: string,
) {
  Object.defineProperty(response, API_ERROR_CODE, {
    configurable: true,
    value: error.error.code,
  });
  sendJson(response, statusCode, error, requestId);
}

function sendMetrics(
  response: http.ServerResponse,
  body: string,
  requestId: string,
) {
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    "text/plain; version=0.0.4; charset=utf-8",
  );
  response.setHeader("x-request-id", requestId);
  response.end(body);
}

function isLivePath(pathname: string) {
  return (
    pathname === "/health/live" || pathname === `${API_V1_PREFIX}/health/live`
  );
}

function isReadyPath(pathname: string) {
  return (
    pathname === "/health/ready" || pathname === `${API_V1_PREFIX}/health/ready`
  );
}

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
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

function requestMethodGroup(method: string | undefined) {
  return method && HTTP_METHODS.has(method) ? method : "OTHER";
}

function requestPathGroup(pathname: string) {
  if (pathname === "/metrics") return "/metrics";
  if (isLivePath(pathname)) return "/health/live";
  if (isReadyPath(pathname)) return "/health/ready";
  const match = pathname.match(/^\/api\/v1\/([a-z-]+)(?:\/|$)/);
  return match?.[1] && API_ROUTE_GROUPS.has(match[1])
    ? `/api/v1/${match[1]}`
    : "/unmatched";
}

function migrationPhase(pathname: string) {
  const isImport = pathname.startsWith(`${API_V1_PREFIX}/migrations/`);
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

function isAuthPath(pathname: string, route: string) {
  return pathname === `${API_V1_PREFIX}/auth/${route}`;
}

function isWorkspacePath(pathname: string, route: string) {
  return pathname === `${API_V1_PREFIX}/workspaces/${route}`;
}

function isAssetPath(pathname: string, route: string) {
  return pathname === `${API_V1_PREFIX}/assets/${route}`;
}

function getAssetUploadCompleteId(pathname: string) {
  const prefix = `${API_V1_PREFIX}/assets/uploads/`;

  if (!pathname.startsWith(prefix) || !pathname.endsWith("/complete")) {
    return null;
  }

  const uploadId = pathname.slice(prefix.length, -"/complete".length);
  return uploadId ? decodeURIComponent(uploadId) : null;
}

function getAssetReadRoute(pathname: string) {
  const prefix = `${API_V1_PREFIX}/assets/`;

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const segments = pathname.slice(prefix.length).split("/");
  if (!segments[0] || segments[0] === "uploads" || segments.length > 2) {
    return null;
  }

  if (segments.length === 2 && segments[1] !== "url") {
    return null;
  }

  try {
    return {
      assetId: decodeURIComponent(segments[0]),
      action: segments[1] ?? null,
    };
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid asset path",
    });
  }
}

function getAuthSessionIdFromPath(pathname: string) {
  const prefix = `${API_V1_PREFIX}/auth/sessions/`;

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const sessionId = pathname.slice(prefix.length);
  return sessionId ? decodeURIComponent(sessionId) : null;
}

function getAuthDeviceIdFromPath(pathname: string) {
  const prefix = `${API_V1_PREFIX}/auth/devices/`;

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const deviceId = pathname.slice(prefix.length);
  return deviceId ? decodeURIComponent(deviceId) : null;
}

function getMigrationImportRoute(pathname: string): {
  importId: string | null;
  logicalAssetId: string | null;
  partNumber: number | null;
  action:
    | "prepare"
    | "cancel"
    | "commit"
    | "asset_upload"
    | "asset_complete"
    | "asset_cancel"
    | "asset_part_complete"
    | null;
} | null {
  const collectionPath = `${API_V1_PREFIX}/migrations/imports`;
  if (pathname === `${collectionPath}/prepare`) {
    return {
      importId: null,
      logicalAssetId: null,
      partNumber: null,
      action: "prepare",
    };
  }
  const prefix = `${collectionPath}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const segments = pathname.slice(prefix.length).split("/");
  if (!segments[0] || segments[0] === "prepare" || segments.length > 6) {
    return null;
  }
  try {
    if (segments.length === 1) {
      return {
        importId: decodeURIComponent(segments[0]),
        logicalAssetId: null,
        partNumber: null,
        action: null,
      };
    }
    if (segments.length === 2 && segments[1] === "cancel") {
      return {
        importId: decodeURIComponent(segments[0]),
        logicalAssetId: null,
        partNumber: null,
        action: "cancel",
      };
    }
    if (segments.length === 2 && segments[1] === "commit") {
      return {
        importId: decodeURIComponent(segments[0]),
        logicalAssetId: null,
        partNumber: null,
        action: "commit",
      };
    }
    if (segments.length < 4 || segments[1] !== "assets") {
      return null;
    }
    const importId = decodeURIComponent(segments[0]);
    const logicalAssetId = decodeURIComponent(segments[2] ?? "");
    if (segments[3] === "upload" && segments.length === 4) {
      return {
        importId,
        logicalAssetId,
        partNumber: null,
        action: "asset_upload",
      };
    }
    if (segments[3] === "complete" && segments.length === 4) {
      return {
        importId,
        logicalAssetId,
        partNumber: null,
        action: "asset_complete",
      };
    }
    if (segments[3] === "cancel" && segments.length === 4) {
      return {
        importId,
        logicalAssetId,
        partNumber: null,
        action: "asset_cancel",
      };
    }
    if (
      segments[3] === "parts" &&
      segments.length === 6 &&
      segments[5] === "complete"
    ) {
      const partNumber = Number(segments[4]);
      if (!Number.isSafeInteger(partNumber) || partNumber < 1) {
        throw new AuthServiceError({
          statusCode: 400,
          apiCode: "VALIDATION_FAILED",
          message: "Invalid migration asset part path",
        });
      }
      return {
        importId,
        logicalAssetId,
        partNumber,
        action: "asset_part_complete",
      };
    }
    return null;
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid migration import path",
    });
  }
}

function getMigrationExportRoute(pathname: string): {
  projectId: string;
  exportId: string | null;
  action: "prepare" | "download" | "cancel" | "retry" | null;
} | null {
  const prefix = `${API_V1_PREFIX}/projects/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const segments = pathname.slice(prefix.length).split("/");
  if (
    !segments[0] ||
    segments.length < 3 ||
    segments[1] !== "exports" ||
    segments.length > 4
  ) {
    return null;
  }
  try {
    const projectId = decodeURIComponent(segments[0]);
    if (segments[2] === "prepare" && segments.length === 3) {
      return { projectId, exportId: null, action: "prepare" };
    }
    if (!segments[2] || segments.length > 4) {
      return null;
    }
    if (segments.length === 3) {
      return {
        projectId,
        exportId: decodeURIComponent(segments[2]),
        action: null,
      };
    }
    if (
      segments.length === 4 &&
      ["download", "cancel", "retry"].includes(segments[3])
    ) {
      return {
        projectId,
        exportId: decodeURIComponent(segments[2]),
        action: segments[3] as "download" | "cancel" | "retry",
      };
    }
    return null;
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid migration export path",
    });
  }
}

function getProjectRoute(pathname: string) {
  const prefix = `${API_V1_PREFIX}/projects/`;

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const segments = pathname.slice(prefix.length).split("/");

  if (segments.length < 1 || segments.length > 4 || !segments[0]) {
    return null;
  }

  try {
    return {
      projectId: decodeURIComponent(segments[0]),
      action: segments[1] ?? null,
      subresourceId: segments[2] ? decodeURIComponent(segments[2]) : null,
      subresourceAction: segments[3] ? decodeURIComponent(segments[3]) : null,
    };
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid project path",
    });
  }
}

function createErrorResponse(
  requestId: string,
  error: AuthServiceError,
): ApiErrorResponse {
  return {
    error: {
      code: error.apiCode,
      message: error.message,
      retryable: error.retryable,
      requestId,
      details: error.details,
    },
  };
}

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff)
        return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertJsonBodyShape(root: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 0 },
  ];
  let entries = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    entries += 1;
    if (entries > 100_000 || current.depth > 64) {
      throw new AuthServiceError({
        statusCode: 400,
        apiCode: "VALIDATION_FAILED",
        message: "Request JSON exceeds structural limits",
      });
    }
    if (typeof current.value === "string") {
      if (!isWellFormedUnicode(current.value)) {
        throw new AuthServiceError({
          statusCode: 400,
          apiCode: "VALIDATION_FAILED",
          message: "Request JSON contains invalid Unicode",
        });
      }
      continue;
    }
    if (typeof current.value === "number" && !Number.isFinite(current.value)) {
      throw new AuthServiceError({
        statusCode: 400,
        apiCode: "VALIDATION_FAILED",
        message: "Request JSON contains a non-finite number",
      });
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, value] of Object.entries(current.value)) {
      if (!isWellFormedUnicode(key)) {
        throw new AuthServiceError({
          statusCode: 400,
          apiCode: "VALIDATION_FAILED",
          message: "Request JSON contains invalid Unicode",
        });
      }
      stack.push({ value, depth: current.depth + 1 });
    }
  }
}

async function readJsonBody<T>(
  request: http.IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maxBytes) {
      throw new AuthServiceError({
        statusCode: 413,
        apiCode: "VALIDATION_FAILED",
        message: "Request body is too large",
      });
    }

    chunks.push(buffer);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Request body must use valid UTF-8 JSON",
    });
  }

  if (!text.trim()) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Request body is required",
    });
  }

  try {
    if (hasDuplicateJsonObjectKeys(text)) {
      throw new Error("duplicate JSON object key");
    }
    const parsed = JSON.parse(text) as T;
    assertJsonBodyShape(parsed);
    return parsed;
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Request body must be valid JSON",
    });
  }
}

async function readOptionalJsonBody<T>(
  request: http.IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<T | undefined> {
  const hasBody =
    request.headers["transfer-encoding"] !== undefined ||
    Number(request.headers["content-length"] ?? 0) > 0;
  return hasBody ? readJsonBody<T>(request, maxBytes) : undefined;
}

async function assertOptionalEmptyBody(request: http.IncomingMessage) {
  const hasBody =
    request.headers["transfer-encoding"] !== undefined ||
    Number(request.headers["content-length"] ?? 0) > 0;
  if (!hasBody) {
    return;
  }
  const body = await readJsonBody<unknown>(request);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length > 0
  ) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Migration cancel body must be an empty object",
    });
  }
}

function getAuthContext(
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

function setCookieHeaders(
  response: http.ServerResponse,
  setCookieHeaders: string[],
) {
  if (setCookieHeaders.length > 0) {
    response.setHeader("set-cookie", setCookieHeaders);
  }
}

async function handleAuthRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
) {
  const context = getAuthContext(request, requestId);

  try {
    if (
      request.method === "POST" &&
      isAuthPath(requestUrl.pathname, "register")
    ) {
      const result = await authService.register(
        await readJsonBody<RegisterRequest>(request),
        context,
      );
      setCookieHeaders(response, result.setCookieHeaders);
      sendJson(response, 201, result.response, requestId);
      return true;
    }

    if (request.method === "POST" && isAuthPath(requestUrl.pathname, "login")) {
      const result = await authService.login(
        await readJsonBody<LoginRequest>(request),
        context,
      );
      setCookieHeaders(response, result.setCookieHeaders);
      sendJson(response, 200, result.response, requestId);
      return true;
    }

    if (
      request.method === "GET" &&
      isAuthPath(requestUrl.pathname, "session")
    ) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      sendJson(response, 200, await authService.getSession(context), requestId);
      return true;
    }

    if (
      request.method === "POST" &&
      isAuthPath(requestUrl.pathname, "logout")
    ) {
      if (context.cookieHeader) {
        const result = await authService.logout(context);
        setCookieHeaders(response, result.setCookieHeaders);
      }

      const payload: LogoutResponse = { ok: true };
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      request.method === "GET" &&
      isAuthPath(requestUrl.pathname, "sessions")
    ) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      const payload: AuthSessionsResponse =
        await authService.listSessions(context);
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      request.method === "GET" &&
      isAuthPath(requestUrl.pathname, "devices")
    ) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      const payload: AuthDevicesResponse =
        await authService.listDevices(context);
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      request.method === "POST" &&
      isAuthPath(requestUrl.pathname, "email/resend")
    ) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      const payload: EmailVerificationResponse =
        await authService.resendVerificationEmail(context);
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      request.method === "POST" &&
      isAuthPath(requestUrl.pathname, "email/verify")
    ) {
      const payload: EmailVerificationResponse = await authService.verifyEmail(
        await readJsonBody<EmailVerifyRequest>(request),
        context,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      request.method === "POST" &&
      isAuthPath(requestUrl.pathname, "password/forgot")
    ) {
      const payload: PasswordResetResponse =
        await authService.requestPasswordReset(
          await readJsonBody<PasswordForgotRequest>(request),
          context,
        );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      request.method === "POST" &&
      isAuthPath(requestUrl.pathname, "password/reset")
    ) {
      const payload: PasswordResetResponse = await authService.resetPassword(
        await readJsonBody<PasswordResetRequest>(request),
        context,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    const sessionId = getAuthSessionIdFromPath(requestUrl.pathname);

    if (request.method === "DELETE" && sessionId) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      const result = await authService.revokeSession(sessionId, context);
      setCookieHeaders(response, result.setCookieHeaders);
      const payload: RevokeSessionResponse = result.response;
      sendJson(response, 200, payload, requestId);
      return true;
    }

    const deviceId = getAuthDeviceIdFromPath(requestUrl.pathname);

    if (request.method === "DELETE" && deviceId) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      const payload: RemoveDeviceResponse = await authService.removeDevice(
        deviceId,
        context,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(
        response,
        error.statusCode,
        createErrorResponse(requestId, error),
        requestId,
      );
      return true;
    }

    throw error;
  }
}

async function handleWorkspaceRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  workspaceUsageService: WorkspaceUsageService,
) {
  const context = getAuthContext(request, requestId);

  try {
    if (
      request.method === "GET" &&
      isWorkspacePath(requestUrl.pathname, "current")
    ) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      const session = await authService.getSession(context);
      const payload: CurrentWorkspaceResponse = {
        workspace: session.workspace,
      };
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      request.method === "GET" &&
      isWorkspacePath(requestUrl.pathname, "current/usage")
    ) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "AUTH_REQUIRED",
          message: "Authentication required",
        });
      }

      const session = await authService.getSession(context);
      const payload = await workspaceUsageService.getCurrentUsage({
        userId: session.user.id,
        workspaceId: session.workspace.id,
      });
      sendJson(response, 200, payload, requestId);
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(
        response,
        error.statusCode,
        createErrorResponse(requestId, error),
        requestId,
      );
      return true;
    }

    throw error;
  }
}

async function handleGenerationTelemetryRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  generationTelemetryService: GenerationTelemetryService,
) {
  if (
    requestUrl.pathname !== `${API_V1_PREFIX}/telemetry/generations` ||
    request.method !== "POST"
  ) {
    return false;
  }

  const context = getAuthContext(request, requestId);

  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }

    const session = await authService.getSession(context);
    const payload = await generationTelemetryService.record(
      await readJsonBody<GenerationTelemetryRequest>(request, 2 * 1024),
      {
        userId: session.user.id,
        workspaceId: session.workspace.id,
      },
    );
    sendJson(response, 202, payload, requestId);
    return true;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(
        response,
        error.statusCode,
        createErrorResponse(requestId, error),
        requestId,
      );
      return true;
    }

    throw error;
  }
}

async function handleProjectRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  projectGraphService: ProjectGraphService,
  projectSnapshotService: ProjectSnapshotService,
  projectService: ProjectService,
) {
  const isCollectionPath = requestUrl.pathname === `${API_V1_PREFIX}/projects`;

  if (
    !isCollectionPath &&
    !requestUrl.pathname.startsWith(`${API_V1_PREFIX}/projects/`)
  ) {
    return false;
  }

  const context = getAuthContext(request, requestId);

  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }

    const session = await authService.getSession(context);
    const actor = {
      userId: session.user.id,
      workspaceId: session.workspace.id,
    };

    if (isCollectionPath && request.method === "GET") {
      const statusValue = requestUrl.searchParams.get("status");
      const limitValue = requestUrl.searchParams.get("limit");
      const payload = await projectService.listProjects(
        {
          status:
            statusValue === null
              ? undefined
              : (statusValue as ProjectListStatus),
          cursor: requestUrl.searchParams.get("cursor"),
          limit: limitValue === null ? undefined : Number(limitValue),
        },
        actor,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (isCollectionPath && request.method === "POST") {
      const payload = await projectService.createProject(
        await readJsonBody<CreateProjectRequest>(request),
        actor,
      );
      sendJson(response, 201, payload, requestId);
      return true;
    }

    const route = getProjectRoute(requestUrl.pathname);

    if (!route) {
      return false;
    }

    if (route.action === "graph" && request.method === "GET") {
      sendJson(
        response,
        200,
        await projectGraphService.getGraph(route.projectId, actor),
        requestId,
      );
      return true;
    }

    if (route.action === "graph" && request.method === "PATCH") {
      const payload = await projectGraphService.applyOperations(
        route.projectId,
        await readJsonBody<ApplyProjectGraphOperationsRequest>(
          request,
          2 * 1024 * 1024,
        ),
        actor,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (route.action === "changes" && request.method === "GET") {
      const after = validateProjectGraphChangesAfter(
        requestUrl.searchParams.get("after"),
      );
      sendJson(
        response,
        200,
        await projectGraphService.getChanges(route.projectId, after, actor),
        requestId,
      );
      return true;
    }

    if (route.action === "checkpoints" && request.method === "POST") {
      const payload = await projectSnapshotService.createCheckpoint(
        route.projectId,
        await readJsonBody<CreateProjectCheckpointRequest>(request),
        actor,
      );
      sendJson(response, 201, payload, requestId);
      return true;
    }

    if (route.action === "revisions" && request.method === "GET") {
      if (route.subresourceId && !route.subresourceAction) {
        const payload = await projectSnapshotService.getRevision(
          route.projectId,
          Number(route.subresourceId),
          actor,
        );
        sendJson(response, 200, payload, requestId);
        return true;
      }

      const limitValue = requestUrl.searchParams.get("limit");
      const payload = await projectSnapshotService.listRevisions(
        route.projectId,
        {
          cursor: requestUrl.searchParams.get("cursor"),
          limit: limitValue === null ? undefined : Number(limitValue),
        },
        actor,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (
      route.action === "revisions" &&
      route.subresourceId &&
      route.subresourceAction === "restore" &&
      request.method === "POST"
    ) {
      const payload = await projectSnapshotService.restoreRevision(
        route.projectId,
        Number(route.subresourceId),
        await readJsonBody<RestoreProjectRevisionRequest>(request),
        actor,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (route.action === null && request.method === "GET") {
      sendJson(
        response,
        200,
        await projectService.getProject(route.projectId, actor),
        requestId,
      );
      return true;
    }

    if (route.action === null && request.method === "PATCH") {
      const payload = await projectService.renameProject(
        route.projectId,
        await readJsonBody<RenameProjectRequest>(request),
        actor,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    if (route.action === "archive" && request.method === "POST") {
      sendJson(
        response,
        200,
        await projectService.archiveProject(route.projectId, actor),
        requestId,
      );
      return true;
    }

    if (route.action === "restore" && request.method === "POST") {
      sendJson(
        response,
        200,
        await projectService.restoreProject(route.projectId, actor),
        requestId,
      );
      return true;
    }

    if (route.action === null && request.method === "DELETE") {
      sendJson(
        response,
        200,
        await projectService.deleteProject(route.projectId, actor),
        requestId,
      );
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(
        response,
        error.statusCode,
        createErrorResponse(requestId, error),
        requestId,
      );
      return true;
    }

    throw error;
  }
}

async function handleAssetRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  assetService: AssetService,
) {
  if (!requestUrl.pathname.startsWith(`${API_V1_PREFIX}/assets/`)) {
    return false;
  }

  const context = getAuthContext(request, requestId);

  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }

    const session = await authService.getSession(context);
    const actor = {
      userId: session.user.id,
      workspaceId: session.workspace.id,
    };

    if (
      request.method === "POST" &&
      isAssetPath(requestUrl.pathname, "uploads")
    ) {
      const payload = await assetService.createUpload(
        await readJsonBody<CreateAssetUploadRequest>(request),
        actor,
      );
      sendJson(response, 201, payload, requestId);
      return true;
    }

    const completeUploadId = getAssetUploadCompleteId(requestUrl.pathname);
    if (request.method === "POST" && completeUploadId) {
      const payload = await assetService.completeUpload(
        completeUploadId,
        actor,
      );
      sendJson(response, 200, payload, requestId);
      return true;
    }

    const assetReadRoute = getAssetReadRoute(requestUrl.pathname);
    if (request.method === "GET" && assetReadRoute?.action === null) {
      sendJson(
        response,
        200,
        await assetService.getAsset(assetReadRoute.assetId, actor),
        requestId,
      );
      return true;
    }

    if (request.method === "GET" && assetReadRoute?.action === "url") {
      sendJson(
        response,
        200,
        await assetService.getAssetUrl(assetReadRoute.assetId, actor),
        requestId,
      );
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(
        response,
        error.statusCode,
        createErrorResponse(requestId, error),
        requestId,
      );
      return true;
    }

    throw error;
  }
}

function getRateLimitBucket(
  request: http.IncomingMessage,
  pathname: string,
): RateLimitBucket | null {
  const method = request.method ?? "GET";
  if (
    pathname === "/metrics" ||
    isLivePath(pathname) ||
    isReadyPath(pathname) ||
    method === "OPTIONS"
  ) {
    return null;
  }
  if (
    pathname === `${API_V1_PREFIX}/auth/login` ||
    pathname === `${API_V1_PREFIX}/auth/register`
  ) {
    return "auth_attempt";
  }
  if (
    pathname.startsWith(`${API_V1_PREFIX}/auth/password/`) ||
    pathname === `${API_V1_PREFIX}/auth/email/verify` ||
    pathname === `${API_V1_PREFIX}/auth/email/resend`
  ) {
    return "password_email";
  }
  if (
    pathname === `${API_V1_PREFIX}/migrations/imports/prepare` ||
    pathname.endsWith("/exports/prepare")
  ) {
    return "migration_prepare";
  }
  if (
    pathname.startsWith(`${API_V1_PREFIX}/assets/uploads`) &&
    method === "POST"
  ) {
    return "asset_prepare";
  }
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

function getControlledNetworkIdentity(
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

function createRequestAuthService(
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

async function getTrustedRateLimitScopes(
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

function sendRateLimitResponse(
  response: http.ServerResponse,
  decision: RateLimitDecision,
  requestId: string,
) {
  const retryAfterSeconds = Math.max(1, decision.retryAfterSeconds);
  response.setHeader("retry-after", String(retryAfterSeconds));
  if (!decision.available) {
    sendJson(
      response,
      503,
      {
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
      },
      requestId,
    );
    return;
  }
  sendJson(
    response,
    429,
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        retryable: true,
        requestId,
        details: { retryAfterSeconds },
      },
    },
    requestId,
  );
}

async function handleMigrationImportRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  migrationImportService: MigrationImportService,
  migrationAssetUploadService: MigrationAssetUploadService,
) {
  const route = getMigrationImportRoute(requestUrl.pathname);
  if (!route) {
    return false;
  }
  const context = getAuthContext(request, requestId);
  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }
    const session = await authService.getSession(context);
    const actor = {
      userId: session.user.id,
      workspaceId: session.workspace.id,
    };

    if (
      request.method === "POST" &&
      route.action === "prepare" &&
      route.importId === null
    ) {
      const payload = await migrationImportService.prepareImport(
        await readJsonBody<unknown>(request, 8 * 1024 * 1024),
        actor,
      );
      sendJson(response, 201, payload, requestId);
      return true;
    }
    if (request.method === "GET" && route.importId && route.action === null) {
      sendJson(
        response,
        200,
        await migrationImportService.getImport(route.importId, actor),
        requestId,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      route.importId &&
      route.action === "cancel"
    ) {
      await assertOptionalEmptyBody(request);
      sendJson(
        response,
        200,
        await migrationImportService.cancelImport(route.importId, actor),
        requestId,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      route.importId &&
      route.action === "commit"
    ) {
      sendJson(
        response,
        200,
        await migrationImportService.commitImport(
          route.importId,
          await readJsonBody<unknown>(request, 64 * 1024),
          actor,
        ),
        requestId,
      );
      return true;
    }
    if (
      route.importId &&
      route.logicalAssetId &&
      route.action === "asset_upload"
    ) {
      if (request.method === "GET") {
        sendJson(
          response,
          200,
          await migrationAssetUploadService.getAssetUpload(
            route.importId,
            route.logicalAssetId,
            actor,
          ),
          requestId,
        );
        return true;
      }
      if (request.method === "POST") {
        await assertOptionalEmptyBody(request);
        sendJson(
          response,
          201,
          await migrationAssetUploadService.prepareAssetUpload(
            route.importId,
            route.logicalAssetId,
            actor,
          ),
          requestId,
        );
        return true;
      }
    }
    if (
      request.method === "POST" &&
      route.importId &&
      route.logicalAssetId &&
      route.action === "asset_part_complete"
    ) {
      sendJson(
        response,
        200,
        await migrationAssetUploadService.completeAssetPart(
          route.importId,
          route.logicalAssetId,
          route.partNumber!,
          await readJsonBody<unknown>(request, 32 * 1024),
          actor,
        ),
        requestId,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      route.importId &&
      route.logicalAssetId &&
      route.action === "asset_complete"
    ) {
      sendJson(
        response,
        200,
        await migrationAssetUploadService.completeAssetUpload(
          route.importId,
          route.logicalAssetId,
          await readOptionalJsonBody<unknown>(request, 128 * 1024),
          actor,
        ),
        requestId,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      route.importId &&
      route.logicalAssetId &&
      route.action === "asset_cancel"
    ) {
      await assertOptionalEmptyBody(request);
      sendJson(
        response,
        200,
        await migrationAssetUploadService.cancelAssetUpload(
          route.importId,
          route.logicalAssetId,
          actor,
        ),
        requestId,
      );
      return true;
    }
    return false;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(
        response,
        error.statusCode,
        createErrorResponse(requestId, error),
        requestId,
      );
      return true;
    }
    throw error;
  }
}

async function handleMigrationExportRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  migrationExportService: MigrationExportService,
) {
  const route = getMigrationExportRoute(requestUrl.pathname);
  if (!route) {
    return false;
  }
  const context = getAuthContext(request, requestId);
  try {
    if (
      request.method === "POST" &&
      route.action === "prepare" &&
      route.exportId === null
    ) {
      const session = await authService.getSession(context);
      sendJson(
        response,
        201,
        await migrationExportService.prepareExport(
          route.projectId,
          await readJsonBody<unknown>(request, 64 * 1024),
          { userId: session.user.id, workspaceId: session.workspace.id },
        ),
        requestId,
      );
      return true;
    }
    const session = await authService.getSession(context);
    const actor = {
      userId: session.user.id,
      workspaceId: session.workspace.id,
    };
    if (route.exportId && route.action === null && request.method === "GET") {
      sendJson(
        response,
        200,
        await migrationExportService.getExport(
          route.projectId,
          route.exportId,
          actor,
        ),
        requestId,
      );
      return true;
    }
    if (
      route.exportId &&
      route.action === "download" &&
      request.method === "GET"
    ) {
      sendJson(
        response,
        200,
        await migrationExportService.downloadExport(
          route.projectId,
          route.exportId,
          actor,
        ),
        requestId,
      );
      return true;
    }
    if (
      route.exportId &&
      route.action === "cancel" &&
      request.method === "POST"
    ) {
      await assertOptionalEmptyBody(request);
      sendJson(
        response,
        200,
        await migrationExportService.cancelExport(
          route.projectId,
          route.exportId,
          actor,
        ),
        requestId,
      );
      return true;
    }
    if (
      route.exportId &&
      route.action === "retry" &&
      request.method === "POST"
    ) {
      await assertOptionalEmptyBody(request);
      sendJson(
        response,
        200,
        await migrationExportService.retryExport(
          route.projectId,
          route.exportId,
          actor,
        ),
        requestId,
      );
      return true;
    }
    throw new AuthServiceError({
      statusCode: 404,
      apiCode: "RESOURCE_NOT_FOUND",
      message: "Route not found",
    });
  } catch (error) {
    const serviceError =
      error instanceof AuthServiceError
        ? error
        : new AuthServiceError({
            statusCode: 500,
            apiCode: "SERVICE_UNAVAILABLE",
            message: "Migration export request failed",
          });
    sendApiError(
      response,
      serviceError.statusCode,
      createErrorResponse(requestId, serviceError),
      requestId,
    );
    return true;
  }
}

export function createApiServer({
  config,
  logger = createJsonLogger({ level: config.logLevel, service: "api" }),
  authService = createUnavailableAuthService(),
  generationTelemetryService = createUnavailableGenerationTelemetryService(),
  assetService = createUnavailableAssetService(),
  projectGraphService = createUnavailableProjectGraphService(),
  projectSnapshotService = createUnavailableProjectSnapshotService(),
  projectService = createUnavailableProjectService(),
  workspaceUsageService = createUnavailableWorkspaceUsageService(),
  migrationImportService = createUnavailableMigrationImportService(),
  migrationAssetUploadService = createUnavailableMigrationAssetUploadService(),
  migrationExportService = createUnavailableMigrationExportService(),
  siteConfigService = createUnavailablePublicSiteConfigService(),
  metrics = createMetricsRegistry(),
  postgresPoolStats,
  readinessChecks,
  rateLimiter,
}: ServerOptions) {
  const server = http.createServer(async (request, response) => {
    const requestId = createRequestId();
    const startedAt = performance.now();
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const requestAuthService = createRequestAuthService(authService, requestId);

    response.once("finish", () => {
      const statusClass = `${Math.floor(response.statusCode / 100)}xx`;
      const route = requestPathGroup(requestUrl.pathname);
      metrics.increment("api_requests_total", 1, {
        method: requestMethodGroup(request.method),
        route,
        status_class: statusClass,
      });
      metrics.observe(
        "api_request_duration_seconds",
        (performance.now() - startedAt) / 1_000,
        { route },
      );
      if (response.statusCode >= 400) {
        metrics.increment("api_errors_total", 1, {
          route,
          status_class: statusClass,
        });
      }
      if (response.statusCode === 401 || response.statusCode === 403) {
        metrics.increment("api_auth_failures_total", 1, {
          route,
          status_class: statusClass,
        });
      }
      if (response.statusCode === 429) {
        metrics.increment("api_rate_limited_total", 1, { route });
      }
      const errorCode = (
        response as http.ServerResponse & { [API_ERROR_CODE]?: string }
      )[API_ERROR_CODE];
      if (errorCode === "PROJECT_VERSION_CONFLICT")
        metrics.increment("project_version_conflicts_total", 1);
      if (errorCode === "QUOTA_EXCEEDED")
        metrics.increment("storage_quota_exceeded_total", 1);
      const phase = migrationPhase(requestUrl.pathname);
      if (phase) {
        metrics.increment("migration_operations_total", 1, {
          phase,
          outcome: response.statusCode < 400 ? "success" : "failure",
        });
      }
    });

    logger.info("request.received", {
      requestId,
      method: request.method,
      pathGroup: requestPathGroup(requestUrl.pathname),
    });

    if (handleSecurityBoundary(request, response, config, requestId)) {
      return;
    }

    if (requestUrl.pathname === "/metrics") {
      if (request.method !== "GET") {
        sendJson(
          response,
          404,
          createServiceUnavailableError(requestId, "Route not found"),
          requestId,
        );
        return;
      }
      if (postgresPoolStats) {
        const pool = postgresPoolStats();
        metrics.setGauge("postgres_pool_connections", pool.total, {
          state: "total",
        });
        metrics.setGauge("postgres_pool_connections", pool.idle, {
          state: "idle",
        });
        metrics.setGauge("postgres_pool_connections", pool.waiting, {
          state: "waiting",
        });
      }
      sendMetrics(response, metrics.renderPrometheus(), requestId);
      return;
    }

    if (isLivePath(requestUrl.pathname)) {
      if (request.method !== "GET") {
        sendJson(
          response,
          404,
          createServiceUnavailableError(requestId, "Route not found"),
          requestId,
        );
        return;
      }

      const payload: HealthResponse = {
        status: "ok",
        service: "api",
        requestId,
        uptimeSeconds: Math.round(process.uptime()),
        checkedAt: new Date().toISOString(),
      };
      sendJson(response, 200, payload, requestId);
      return;
    }

    if (isReadyPath(requestUrl.pathname)) {
      if (request.method !== "GET") {
        sendJson(
          response,
          404,
          createServiceUnavailableError(requestId, "Route not found"),
          requestId,
        );
        return;
      }

      const dependencies = await checkReadinessDependencies(readinessChecks);
      for (const [dependency, status] of Object.entries(dependencies)) {
        metrics.setGauge("dependency_up", status.ok ? 1 : 0, { dependency });
      }
      const ok = Object.values(dependencies).every(
        (dependency) => dependency.ok,
      );
      const payload: HealthResponse = {
        status: ok ? "ok" : "degraded",
        service: "api",
        requestId,
        uptimeSeconds: Math.round(process.uptime()),
        checkedAt: new Date().toISOString(),
        dependencies,
      };
      sendJson(response, ok ? 200 : 503, payload, requestId);
      return;
    }

    if (requestUrl.pathname === `${API_V1_PREFIX}/site-config`) {
      if (request.method !== "GET") {
        sendJson(
          response,
          404,
          createServiceUnavailableError(requestId, "Route not found"),
          requestId,
        );
        return;
      }
      try {
        const payload = await siteConfigService.getCurrent();
        response.setHeader("etag", payload.etag);
        response.setHeader(
          "cache-control",
          "public, max-age=60, stale-if-error=300",
        );
        if (request.headers["if-none-match"] === payload.etag) {
          response.statusCode = 304;
          response.setHeader("x-request-id", requestId);
          response.end();
          return;
        }
        sendJson(response, 200, payload, requestId);
      } catch {
        sendApiError(
          response,
          503,
          createServiceUnavailableError(
            requestId,
            "Site configuration is unavailable",
          ),
          requestId,
        );
      }
      return;
    }

    if (rateLimiter) {
      const bucket = getRateLimitBucket(request, requestUrl.pathname);
      if (bucket) {
        const networkDecision = await rateLimiter.consume(bucket, [
          `ip:${getControlledNetworkIdentity(request, config.trustProxy)}`,
        ]);
        if (!networkDecision.allowed) {
          sendRateLimitResponse(response, networkDecision, requestId);
          return;
        }
        if (bucket !== "auth_attempt") {
          const trustedScopes = await getTrustedRateLimitScopes(
            request,
            requestId,
            requestAuthService,
          );
          if (trustedScopes.length > 0) {
            const identityDecision = await rateLimiter.consume(
              bucket,
              trustedScopes,
            );
            if (!identityDecision.allowed) {
              sendRateLimitResponse(response, identityDecision, requestId);
              return;
            }
          }
        }
      }
    }

    if (
      await handleAuthRoute(
        request,
        response,
        requestUrl,
        requestId,
        requestAuthService,
      )
    ) {
      return;
    }

    if (
      await handleWorkspaceRoute(
        request,
        response,
        requestUrl,
        requestId,
        requestAuthService,
        workspaceUsageService,
      )
    ) {
      return;
    }

    if (
      await handleGenerationTelemetryRoute(
        request,
        response,
        requestUrl,
        requestId,
        requestAuthService,
        generationTelemetryService,
      )
    ) {
      return;
    }

    if (
      await handleAssetRoute(
        request,
        response,
        requestUrl,
        requestId,
        requestAuthService,
        assetService,
      )
    ) {
      return;
    }

    if (
      await handleMigrationImportRoute(
        request,
        response,
        requestUrl,
        requestId,
        requestAuthService,
        migrationImportService,
        migrationAssetUploadService,
      )
    ) {
      return;
    }

    if (
      await handleMigrationExportRoute(
        request,
        response,
        requestUrl,
        requestId,
        requestAuthService,
        migrationExportService,
      )
    ) {
      return;
    }

    if (
      await handleProjectRoute(
        request,
        response,
        requestUrl,
        requestId,
        requestAuthService,
        projectGraphService,
        projectSnapshotService,
        projectService,
      )
    ) {
      return;
    }

    sendJson(
      response,
      404,
      createServiceUnavailableError(requestId, "Route not found"),
      requestId,
    );
  });

  return server;
}

export async function closeApiServer(server: http.Server, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out closing API server")),
      timeoutMs,
    );
    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
