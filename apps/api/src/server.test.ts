import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  API_V1_PREFIX,
  type AssetResponse,
  type AssetUploadResponse,
  type AssetUrlResponse,
  type ApplyProjectGraphOperationsResponse,
  type AuthDevicesResponse,
  type AuthSessionResponse,
  type AuthSessionsResponse,
  type CompleteAssetUploadResponse,
  type AuthSuccessResponse,
  type CurrentWorkspaceResponse,
  type WorkspaceUsageResponse,
  type ProjectCheckpointResponse,
  type ProjectGraphChangesResponse,
  type ProjectGraphResponse,
  type ProjectRevisionRestoreResponse,
  type ProjectRevisionResponse,
  type ProjectRevisionsResponse,
  type ProjectResponse,
  type ProjectsResponse,
  type RevokeSessionResponse,
  type MigrationImportResponse,
  type MigrationImportAssetUploadResponse,
  type MigrationExportResponse,
  DEFAULT_SITE_CONFIG,
} from "@ai-canvas-cloud/contracts";
import type {
  AssetCleanupService,
  AssetService,
} from "@ai-canvas-cloud/server/modules/assets";
import {
  BETTER_AUTH_SESSION_COOKIE_NAME,
  AuthServiceError,
  type AuthService,
  type IssuedAuthSession,
} from "@ai-canvas-cloud/server/modules/auth";
import {
  validateGenerationTelemetryRequest,
  type GenerationTelemetryService,
} from "@ai-canvas-cloud/server/modules/generation-telemetry";
import type { ProjectGraphService } from "@ai-canvas-cloud/server/modules/project-graph";
import type {
  MigrationAssetUploadService,
  MigrationExportService,
  MigrationImportService,
} from "@ai-canvas-cloud/server/modules/migrations";
import type { ProjectSnapshotService } from "@ai-canvas-cloud/server/modules/project-snapshots";
import type {
  ProjectActor,
  ProjectService,
} from "@ai-canvas-cloud/server/modules/projects";
import type { WorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
import { createMetricsRegistry, type Logger } from "@ai-canvas-cloud/shared";
import { createFastifyApiServer } from "../dist/fastify/server.js";
import { closeApiServer } from "../dist/serverLifecycle.js";
import type { ApiConfig } from "./config.ts";
import type { RateLimiter } from "./rateLimit.ts";

const config: ApiConfig = {
  env: "test",
  logLevel: "error",
  host: "127.0.0.1",
  port: 0,
  trustProxy: false,
  shutdownTimeoutMs: 1_000,
  betterAuthUrl: "http://127.0.0.1:8787",
  betterAuthSecret: "test-better-auth-secret-that-is-long-enough",
  webPublicUrl: "http://localhost:5173",
  webAllowedOrigins: ["http://localhost:5173"],
  databaseUrl: "postgres://localhost:5432/ai_canvas_cloud",
  redisUrl: "redis://localhost:6379",
  s3Endpoint: "http://localhost:9000",
  s3PublicEndpoint: "http://localhost:9000",
  s3Bucket: "ai-canvas-cloud",
  s3Region: "local",
  s3AccessKeyId: "test",
  s3SecretAccessKey: "test",
  objectStorageEnvironmentFallback: true,
  s3PublicOrigin: "http://localhost:9000",
  s3ForcePathStyle: true,
  objectStorageCredentialActiveKeyVersion: 1,
  assetMaintenanceToken: "asset-maintenance-token-for-tests-123456",
  devSeedAdmin: false,
  devSeedAdminUsername: "admin_user",
  devSeedAdminEmail: "admin@example.com",
  authEmailTransport: "development",
  smtpCredentialActiveKeyVersion: 1,
};

function createAuthResponse(expiresAt: Date): AuthSuccessResponse {
  return {
    user: {
      id: "user_1",
      userNumber: 10001,
      username: "Artist_01",
      email: "artist@example.com",
      status: "active",
      emailVerified: true,
    },
    workspace: {
      id: "workspace_1",
      type: "personal",
      name: "artist 的个人空间",
      role: "owner",
      status: "active",
      planKey: "free",
    },
    session: {
      expiresAt: expiresAt.toISOString(),
    },
  };
}

function createFakeAuthService(): AuthService {
  const expiresAt = new Date(Date.now() + 60_000);
  const issued: IssuedAuthSession = {
    response: createAuthResponse(expiresAt),
    setCookieHeaders: [
      `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session; HttpOnly; Path=/; SameSite=Lax`,
    ],
  };

  return {
    async register() {
      return issued;
    },
    async login() {
      return issued;
    },
    async getSession(context): Promise<AuthSessionResponse> {
      if (
        !context.cookieHeader?.includes(
          `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
        )
      ) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: "SESSION_EXPIRED",
          message: "Session expired",
        });
      }

      return {
        user: issued.response.user,
        workspace: issued.response.workspace,
      };
    },
    async listSessions() {
      return {
        sessions: [
          {
            id: "session_current",
            deviceLabel: "Test Browser",
            createdAt: new Date(Date.now() - 5_000).toISOString(),
            lastUsedAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
            current: true,
          },
          {
            id: "session_other",
            deviceLabel: "Other Browser",
            createdAt: new Date(Date.now() - 10_000).toISOString(),
            lastUsedAt: new Date(Date.now() - 1_000).toISOString(),
            expiresAt: expiresAt.toISOString(),
            current: false,
          },
        ],
      };
    },
    async listDevices() {
      return {
        devices: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            deviceLabel: "Test Browser",
            firstSeenAt: new Date(Date.now() - 5_000).toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: true,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            deviceLabel: "Other Browser",
            firstSeenAt: new Date(Date.now() - 10_000).toISOString(),
            lastSeenAt: new Date(Date.now() - 1_000).toISOString(),
            current: false,
          },
        ],
      };
    },
    async sendRegistrationEmailCode() {
      return { ok: true, resendAfterSeconds: 60 };
    },
    async requestPasswordReset() {
      return { ok: true };
    },
    async resetPassword() {
      return { ok: true };
    },
    async changePassword() {
      return {
        response: { ok: true },
        setCookieHeaders: [
          `${BETTER_AUTH_SESSION_COOKIE_NAME}=changed_session; HttpOnly; Path=/; SameSite=Lax`,
        ],
      };
    },
    async revokeSession(sessionId: string) {
      if (sessionId !== "session_other") {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: "RESOURCE_NOT_FOUND",
          message: "Session not found",
        });
      }

      return {
        response: { ok: true },
        setCookieHeaders: [],
      };
    },
    async removeDevice(deviceId: string) {
      if (deviceId !== "22222222-2222-4222-8222-222222222222") {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: "RESOURCE_NOT_FOUND",
          message: "Device not found",
        });
      }

      return { ok: true };
    },
    async logout() {
      return {
        setCookieHeaders: [
          `${BETTER_AUTH_SESSION_COOKIE_NAME}=; Max-Age=0; Path=/`,
        ],
      };
    },
  };
}

function createProjectResponse(
  overrides: Partial<ProjectResponse["project"]> = {},
): ProjectResponse {
  return {
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "产品主视觉",
      version: 0,
      lastSequence: 0,
      nodeCount: 0,
      edgeCount: 0,
      archivedAt: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      ...overrides,
    },
  };
}

function createFakeProjectService() {
  const actors: ProjectActor[] = [];
  let response = createProjectResponse();

  const capture = (actor: ProjectActor) => {
    actors.push(actor);
  };

  const service: ProjectService = {
    async listProjects(_input, actor): Promise<ProjectsResponse> {
      capture(actor);
      return { projects: [response.project], nextCursor: null };
    },
    async createProject(input, actor) {
      capture(actor);
      response = createProjectResponse({ id: input.id, name: input.name });
      return response;
    },
    async getProject(_projectId, actor) {
      capture(actor);
      return response;
    },
    async renameProject(_projectId, input, actor) {
      capture(actor);
      response = createProjectResponse({ name: input.name });
      return response;
    },
    async archiveProject(_projectId, actor) {
      capture(actor);
      response = createProjectResponse({
        archivedAt: "2026-07-15T01:00:00.000Z",
      });
      return response;
    },
    async restoreProject(_projectId, actor) {
      capture(actor);
      response = createProjectResponse({ archivedAt: null });
      return response;
    },
    async deleteProject(_projectId, actor) {
      capture(actor);
      return { ok: true };
    },
  };

  return { actors, service };
}

function createFakeProjectGraphService() {
  const actors: ProjectActor[] = [];
  const graph: ProjectGraphResponse = {
    projectId: "11111111-1111-4111-8111-111111111111",
    version: 0,
    sequence: 0,
    nodes: [],
    edges: [],
  };
  const service: ProjectGraphService = {
    async getGraph(_projectId, actor) {
      actors.push(actor);
      return graph;
    },
    async getChanges(
      _projectId,
      after,
      actor,
    ): Promise<ProjectGraphChangesResponse> {
      actors.push(actor);
      return {
        projectId: graph.projectId,
        version: graph.version,
        sequence: graph.sequence,
        after,
        changes: [],
        hasMore: false,
      };
    },
    async applyOperations(
      _projectId,
      input,
      actor,
    ): Promise<ApplyProjectGraphOperationsResponse> {
      actors.push(actor);
      const referencesPendingAsset = input.operations.some(
        (operation) =>
          operation.type === "upsertNode" &&
          (operation.node.data.imageAsset as { assetId?: unknown } | undefined)
            ?.assetId === "44444444-4444-4444-8444-444444444444",
      );
      if (referencesPendingAsset) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "ASSET_NOT_READY",
          message: "Referenced asset is not ready",
        });
      }
      if (input.baseVersion !== 0) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "PROJECT_VERSION_CONFLICT",
          message: "Project was updated by another client",
          details: { currentVersion: 1 },
        });
      }

      return {
        projectId: graph.projectId,
        version: 1,
        sequence: 1,
        acceptedBatchId: input.batchId,
        updatedAt: "2026-07-15T01:00:00.000Z",
      };
    },
  };

  return { actors, service };
}

function createFakeProjectSnapshotService() {
  const actors: ProjectActor[] = [];
  const service: ProjectSnapshotService = {
    async listRevisions(
      _projectId,
      input,
      actor,
    ): Promise<ProjectRevisionsResponse> {
      actors.push(actor);
      return {
        revisions: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            projectId: "11111111-1111-4111-8111-111111111111",
            projectVersion: 1,
            lastSequence: 1,
            snapshotType: "manual",
            schemaVersion: 1,
            byteSize: 128,
            isValid: true,
            createdAt: "2026-07-15T02:00:00.000Z",
          },
        ],
        nextCursor: input.limit === 1 ? "cursor_1" : null,
      };
    },
    async getRevision(
      _projectId,
      version,
      actor,
    ): Promise<ProjectRevisionResponse> {
      actors.push(actor);
      if (version !== 1) {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: "RESOURCE_NOT_FOUND",
          message: "Project revision not found",
        });
      }

      return {
        checkpoint: {
          id: "33333333-3333-4333-8333-333333333333",
          projectId: "11111111-1111-4111-8111-111111111111",
          projectVersion: 1,
          lastSequence: 1,
          snapshotType: "manual",
          schemaVersion: 1,
          byteSize: 128,
          isValid: true,
          createdAt: "2026-07-15T02:00:00.000Z",
        },
        record: {
          schemaVersion: 1,
          project: {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Project",
            version: 1,
            lastSequence: 1,
          },
          canvas: { nodes: [], edges: [] },
          taskQueue: { tasks: [] },
        },
      };
    },
    async createCheckpoint(
      _projectId,
      input,
      actor,
    ): Promise<ProjectCheckpointResponse> {
      actors.push(actor);
      if (input.expectedVersion !== 1 || input.expectedSequence !== 1) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "PROJECT_VERSION_CONFLICT",
          message: "Project was updated before checkpoint creation",
          details: { currentVersion: 1, currentSequence: 1 },
        });
      }

      return {
        checkpoint: {
          id: "33333333-3333-4333-8333-333333333333",
          projectId: "11111111-1111-4111-8111-111111111111",
          projectVersion: 1,
          lastSequence: 1,
          snapshotType: input.checkpointType ?? "manual",
          schemaVersion: 1,
          byteSize: 128,
          isValid: true,
          createdAt: "2026-07-15T02:00:00.000Z",
        },
        project: createProjectResponse({ version: 1, lastSequence: 1 }).project,
      };
    },
    async restoreRevision(
      _projectId,
      version,
      input,
      actor,
    ): Promise<ProjectRevisionRestoreResponse> {
      actors.push(actor);
      if (version === 3) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "ASSET_NOT_READY",
          message: "Referenced asset is not ready",
        });
      }
      if (version !== 1) {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: "RESOURCE_NOT_FOUND",
          message: "Project revision not found",
        });
      }
      if (input.expectedVersion !== 2 || input.expectedSequence !== 2) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "PROJECT_VERSION_CONFLICT",
          message: "Project was updated before revision restore",
          details: { currentVersion: 2, currentSequence: 2 },
        });
      }

      return {
        restoredCheckpoint: {
          id: "33333333-3333-4333-8333-333333333333",
          projectId: "11111111-1111-4111-8111-111111111111",
          projectVersion: 1,
          lastSequence: 1,
          snapshotType: "manual",
          schemaVersion: 1,
          byteSize: 128,
          isValid: true,
          createdAt: "2026-07-15T02:00:00.000Z",
        },
        preRestoreCheckpoint: {
          id: "44444444-4444-4444-8444-444444444444",
          projectId: "11111111-1111-4111-8111-111111111111",
          projectVersion: 2,
          lastSequence: 2,
          snapshotType: "pre_restore",
          schemaVersion: 1,
          byteSize: 256,
          isValid: true,
          createdAt: "2026-07-15T03:00:00.000Z",
        },
        project: createProjectResponse({ version: 3, lastSequence: 3 }).project,
        version: 3,
        sequence: 3,
      };
    },
  };

  return { actors, service };
}

function createFakeAssetService() {
  const actors: ProjectActor[] = [];
  const service: AssetService = {
    async createUpload(input, actor): Promise<AssetUploadResponse> {
      actors.push(actor);
      return {
        upload: {
          id: "55555555-5555-4555-8555-555555555555",
          assetId: "66666666-6666-4666-8666-666666666666",
          projectId: input.projectId ?? null,
          originalFileName: input.originalFileName,
          expectedMimeType: input.mimeType,
          expectedByteSize: input.byteSize,
          expectedSha256: input.sha256 ?? null,
          assetKind: input.assetKind,
          status: "pending",
          expiresAt: "2026-07-15T00:15:00.000Z",
          createdAt: "2026-07-15T00:00:00.000Z",
        },
        asset: {
          id: "66666666-6666-4666-8666-666666666666",
          projectId: input.projectId ?? null,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          sha256: input.sha256 ?? null,
          width: input.width ?? null,
          height: input.height ?? null,
          assetKind: input.assetKind,
          status: "pending",
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
        },
        directUpload: {
          method: "PUT",
          url: "http://localhost:9000/ai-canvas-cloud/presigned-upload",
          headers: { "content-type": input.mimeType },
          expiresAt: "2026-07-15T00:15:00.000Z",
        },
      };
    },
    async completeUpload(
      uploadId,
      actor,
    ): Promise<CompleteAssetUploadResponse> {
      actors.push(actor);
      return {
        upload: {
          id: uploadId,
          assetId: "66666666-6666-4666-8666-666666666666",
          projectId: "11111111-1111-4111-8111-111111111111",
          originalFileName: "reference.png",
          expectedMimeType: "image/png",
          expectedByteSize: 2048,
          expectedSha256: null,
          assetKind: "upload",
          status: "completed",
          expiresAt: "2026-07-15T00:15:00.000Z",
          createdAt: "2026-07-15T00:00:00.000Z",
        },
        asset: {
          id: "66666666-6666-4666-8666-666666666666",
          projectId: "11111111-1111-4111-8111-111111111111",
          originalFileName: "reference.png",
          mimeType: "image/png",
          byteSize: 2048,
          sha256: null,
          width: null,
          height: null,
          assetKind: "upload",
          status: "completed",
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:10:00.000Z",
        },
      };
    },
    async getAsset(assetId, actor): Promise<AssetResponse> {
      actors.push(actor);
      return {
        asset: {
          id: assetId,
          projectId: "11111111-1111-4111-8111-111111111111",
          originalFileName: "reference.png",
          mimeType: "image/png",
          byteSize: 2048,
          sha256: null,
          width: null,
          height: null,
          assetKind: "upload",
          status: "completed",
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:10:00.000Z",
        },
      };
    },
    async getAssetUrl(assetId, actor): Promise<AssetUrlResponse> {
      actors.push(actor);
      return {
        assetId,
        url: "http://localhost:9000/ai-canvas-cloud/presigned-read",
        expiresAt: "2026-07-15T00:15:00.000Z",
      };
    },
  };

  return { actors, service };
}

function createFakeWorkspaceUsageService() {
  const actors: ProjectActor[] = [];
  const service: WorkspaceUsageService = {
    async getCurrentUsage(actor): Promise<WorkspaceUsageResponse> {
      actors.push(actor);
      return {
        workspaceId: actor.workspaceId,
        storage: {
          usedBytes: 1024,
          reservedBytes: 512,
          totalBytes: 1536,
          quotaBytes: 10 * 1024 * 1024 * 1024,
          availableBytes: 10 * 1024 * 1024 * 1024 - 1536,
        },
        projects: [
          {
            projectId: "11111111-1111-4111-8111-111111111111",
            name: "Project A",
            fileCount: 2,
            nodeCount: 4,
            storageBytes: 1024,
            archivedAt: null,
            updatedAt: "2026-07-15T00:00:00.000Z",
          },
        ],
      };
    },
  };
  return { actors, service };
}

function createFakeMigrationImportService() {
  const actors: ProjectActor[] = [];
  const calls: string[] = [];
  let status: MigrationImportResponse["import"]["status"] = "prepared";
  const summary = (): MigrationImportResponse => ({
    import: {
      id: "99999999-9999-4999-8999-999999999999",
      status,
      packageId: "package-1",
      sourcePlatform: "electron",
      project: {
        sourceId: "11111111-1111-4111-8111-111111111111",
        name: "Imported project",
        version: 2,
        sequence: 3,
      },
      conflict: {
        type: "none",
        requiresResolution: false,
        targetProject: null,
      },
      allowedStrategies: [],
      estimates: {
        assetCount: 0,
        fileCount: 3,
        totalBytes: 128,
        estimatedStorageBytes: 0,
        availableBytesAtPrepare: 1024,
      },
      progress: { completedFileCount: 0, completedBytes: 0, retryCount: 0 },
      uploads: [],
      error: null,
      cancelRequestedAt: null,
      expiresAt: "2026-07-19T00:00:00.000Z",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  });
  const capture = (actor: ProjectActor, call: string) => {
    actors.push(actor);
    calls.push(call);
  };
  const service: MigrationImportService = {
    async prepareImport(input, actor) {
      capture(
        actor,
        `prepare:${(input as { idempotencyKey?: string }).idempotencyKey ?? ""}`,
      );
      return summary();
    },
    async getImport(importId, actor) {
      capture(actor, `get:${importId}`);
      return summary();
    },
    async cancelImport(importId, actor) {
      capture(actor, `cancel:${importId}`);
      status = "canceled";
      return summary();
    },
    async commitImport(importId, _input, actor) {
      capture(actor, `commit:${importId}`);
      return {
        importId,
        status: "completed",
        strategy: "copy",
        project: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Imported project",
          version: 1,
          sequence: 1,
        },
        assetCount: 0,
        checkpoint: null,
      };
    },
  };
  return { actors, calls, service };
}

function createFakeMigrationExportService() {
  const actors: ProjectActor[] = [];
  const calls: string[] = [];
  let status: MigrationExportResponse["export"]["status"] = "prepared";
  const summary = (): MigrationExportResponse => ({
    export: {
      id: "88888888-8888-4888-8888-888888888888",
      status,
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Export project",
        version: 2,
        sequence: 3,
      },
      progress: {
        fileCount: 4,
        completedFileCount: status === "completed" ? 4 : 0,
        totalBytes: 512,
        completedBytes: status === "completed" ? 512 : 0,
        retryCount: 0,
      },
      archive:
        status === "completed"
          ? { byteSize: 400, sha256: "a".repeat(64) }
          : null,
      error: null,
      cancelRequestedAt: null,
      expiresAt: "2026-07-19T00:00:00.000Z",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  });
  const capture = (actor: ProjectActor, call: string) => {
    actors.push(actor);
    calls.push(call);
  };
  const service: MigrationExportService = {
    async prepareExport(projectId, input, actor) {
      capture(
        actor,
        `prepare:${projectId}:${(input as { idempotencyKey?: string }).idempotencyKey ?? ""}`,
      );
      return summary();
    },
    async getExport(projectId, exportId, actor) {
      capture(actor, `get:${projectId}:${exportId}`);
      return summary();
    },
    async cancelExport(projectId, exportId, actor) {
      capture(actor, `cancel:${projectId}:${exportId}`);
      status = "canceled";
      return summary();
    },
    async retryExport(projectId, exportId, actor) {
      capture(actor, `retry:${projectId}:${exportId}`);
      status = "prepared";
      return summary();
    },
    async downloadExport(projectId, exportId, actor) {
      capture(actor, `download:${projectId}:${exportId}`);
      return {
        exportId,
        url: "https://storage.test/signed-export",
        expiresAt: "2026-07-18T00:05:00.000Z",
      };
    },
    async processExport() {},
    async recoverExports() {},
    async maintainExports() {
      return 0;
    },
  };
  return { actors, calls, service };
}

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function requestJson(
  port: number,
  options: {
    method: string;
    path: string;
    body?: unknown;
    rawBody?: string | Buffer;
    cookie?: string;
    headers?: Record<string, string>;
  },
) {
  return new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: unknown;
  }>((resolve, reject) => {
    const bodyText =
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body));
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: options.path,
        method: options.method,
        headers: {
          ...(bodyText
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(bodyText),
              }
            : {}),
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: text ? (JSON.parse(text) as unknown) : null,
          });
        });
      },
    );

    request.on("error", reject);

    if (bodyText) {
      request.write(bodyText);
    }

    request.end();
  });
}

function requestText(port: number, path: string) {
  return new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject);
  });
}

test("internal asset cleanup requires its bearer token and returns aggregates only", async () => {
  const calls: boolean[] = [];
  const assetCleanupService: AssetCleanupService = {
    async run(input) {
      calls.push(input.apply);
      return {
        mode: input.apply ? "apply" : "preview",
        graceHours: 168,
        cutoff: "2026-07-22T00:00:00.000Z",
        scannedAssetCount: 2,
        reclaimableObjectCount: 1,
        reclaimableBytes: 42,
        deletedObjectCount: input.apply ? 1 : 0,
        deletedBytes: input.apply ? 42 : 0,
        missingObjectCount: 0,
        finalizedMissingAssetCount: 0,
        retainedAssetCount: 1,
        truncated: false,
        completedAt: "2026-07-29T00:00:00.000Z",
      };
    },
  };
  const server = await createFastifyApiServer({
    config,
    assetCleanupService,
  });
  const port = await listen(server);
  try {
    for (const authorization of [undefined, "Bearer wrong-token"]) {
      const rejected = await requestJson(port, {
        method: "POST",
        path: "/internal/v1/asset-cleanup",
        body: { apply: false },
        headers: authorization ? { authorization } : undefined,
      });
      assert.equal(rejected.statusCode, 403);
    }
    assert.deepEqual(calls, []);

    const preview = await requestJson(port, {
      method: "POST",
      path: "/internal/v1/asset-cleanup",
      body: { apply: false },
      headers: {
        authorization: `Bearer ${config.assetMaintenanceToken}`,
      },
    });
    assert.equal(preview.statusCode, 200);
    assert.deepEqual(calls, [false]);
    const serialized = JSON.stringify(preview.body);
    assert.equal(serialized.includes("objectKey"), false);
    assert.equal(serialized.includes("workspace"), false);

    const invalid = await requestJson(port, {
      method: "POST",
      path: "/internal/v1/asset-cleanup",
      body: { apply: false, objectKey: "private/file.png" },
      headers: {
        authorization: `Bearer ${config.assetMaintenanceToken}`,
      },
    });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(calls, [false]);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("public site configuration returns a safe projection with ETag revalidation", async () => {
  const etag = `"${"a".repeat(64)}"`;
  const server = await createFastifyApiServer({
    config,
    siteConfigService: {
      async getCurrent() {
        return {
          etag,
          config: DEFAULT_SITE_CONFIG,
          assets: { logo: null, favicon: null },
        };
      },
    },
  });
  const port = await listen(server);
  try {
    const first = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/site-config`,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers.etag, etag);
    assert.equal(
      (first.body as { config: { siteName: string } }).config.siteName,
      "AI Canvas",
    );
    const cached = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/site-config`,
      headers: { "if-none-match": etag },
    });
    assert.equal(cached.statusCode, 304);
    assert.equal(cached.body, null);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("API enforces the web origin allowlist and emits security headers", async () => {
  const stagingConfig: ApiConfig = {
    ...config,
    env: "staging",
    webPublicUrl: "https://cloud.example.com",
    webAllowedOrigins: ["https://cloud.example.com"],
  };
  const server = await createFastifyApiServer({
    config: stagingConfig,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);

  try {
    const preflight = await requestJson(port, {
      method: "OPTIONS",
      path: `${API_V1_PREFIX}/projects`,
      headers: { origin: "https://cloud.example.com" },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(
      preflight.headers["access-control-allow-origin"],
      "https://cloud.example.com",
    );
    assert.equal(preflight.headers["access-control-allow-credentials"], "true");
    assert.match(
      String(preflight.headers["access-control-allow-methods"]),
      /PATCH/,
    );
    assert.equal(
      preflight.headers["strict-transport-security"],
      "max-age=31536000; includeSubDomains",
    );
    assert.equal(preflight.headers["x-content-type-options"], "nosniff");
    assert.equal(preflight.headers["x-frame-options"], "DENY");
    assert.equal(
      preflight.headers["content-security-policy"],
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );

    const denied = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/login`,
      headers: { origin: "https://evil.example.com" },
      body: {
        identifier: "artist@example.com",
        password: "long-enough-password",
      },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(
      (denied.body as { error: { code: string } }).error.code,
      "ACCESS_DENIED",
    );
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("API rejects duplicate keys, invalid encoding, deep JSON and oversized bodies before auth services", async () => {
  const authService = createFakeAuthService();
  let loginCalls = 0;
  const originalLogin = authService.login;
  authService.login = async (...args) => {
    loginCalls += 1;
    return originalLogin(...args);
  };
  const server = await createFastifyApiServer({ config, authService });
  const port = await listen(server);
  let deepJson = '"leaf"';
  for (let index = 0; index < 66; index += 1)
    deepJson = `{"nested":${deepJson}}`;
  const cases: Array<{
    name: string;
    rawBody: string | Buffer;
    statusCode: number;
  }> = [
    {
      name: "duplicate key",
      rawBody:
        '{"email":"a@example.com","email":"b@example.com","password":"long-enough-password"}',
      statusCode: 400,
    },
    {
      name: "escaped duplicate key",
      rawBody:
        '{"email":"a@example.com","\\u0065mail":"b@example.com","password":"long-enough-password"}',
      statusCode: 400,
    },
    {
      name: "invalid UTF-8",
      rawBody: Buffer.from([0xc3, 0x28]),
      statusCode: 400,
    },
    {
      name: "invalid Unicode surrogate",
      rawBody: '{"email":"\\ud800","password":"long-enough-password"}',
      statusCode: 400,
    },
    { name: "deep object", rawBody: deepJson, statusCode: 400 },
    {
      name: "oversized body",
      rawBody: `{"email":"${"x".repeat(70 * 1024)}"}`,
      statusCode: 413,
    },
  ];

  try {
    for (const scenario of cases) {
      const response = await requestJson(port, {
        method: "POST",
        path: `${API_V1_PREFIX}/auth/login`,
        rawBody: scenario.rawBody,
      });
      assert.equal(response.statusCode, scenario.statusCode, scenario.name);
      assert.equal(
        (response.body as { error: { code: string } }).error.code,
        "VALIDATION_FAILED",
        scenario.name,
      );
    }
    assert.equal(loginCalls, 0);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("API logs and diagnostics exclude credentials, dynamic IDs, query values and request bodies", async () => {
  const entries: Array<{ message: string; context?: Record<string, unknown> }> =
    [];
  const logger: Logger = {
    debug() {},
    info(message, context) {
      entries.push({ message, context });
    },
    warn(message, context) {
      entries.push({ message, context });
    },
    error(message, context) {
      entries.push({ message, context });
    },
  };
  const server = await createFastifyApiServer({
    config,
    logger,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);
  const secret = "security-fixture-secret";

  try {
    const response = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/assets/${secret}/url?token=${secret}`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=${secret}`,
      headers: { authorization: `Bearer ${secret}` },
    });
    assert(response.statusCode >= 400);
    const metrics = await requestText(port, `/metrics?apiKey=${secret}`);
    assert.equal(metrics.statusCode, 200);

    const logs = JSON.stringify(entries);
    assert.equal(logs.includes(secret), false);
    assert.equal(logs.includes("authorization"), false);
    assert.equal(metrics.body.includes(secret), false);
    assert.equal(JSON.stringify(response.body).includes(secret), false);
    assert(
      entries.some((entry) => entry.context?.pathGroup === "/api/v1/assets"),
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("API returns stable rate limit errors before reading request bodies or calling services", async () => {
  const authService = createFakeAuthService();
  let loginCalls = 0;
  authService.login = async (...args) => {
    loginCalls += 1;
    return createFakeAuthService().login(...args);
  };
  const rateLimiter: RateLimiter = {
    async consume(bucket) {
      return { allowed: false, available: true, retryAfterSeconds: 17, bucket };
    },
    async ping() {},
    async close() {},
  };
  const server = await createFastifyApiServer({
    config,
    authService,
    rateLimiter,
  });
  const port = await listen(server);

  try {
    const response = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/login`,
      body: {
        identifier: "artist@example.com",
        password: "long-enough-password",
      },
    });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers["retry-after"], "17");
    assert.equal(
      (response.body as { error: { code: string; retryable: boolean } }).error
        .code,
      "RATE_LIMITED",
    );
    assert.equal(
      (response.body as { error: { retryable: boolean } }).error.retryable,
      true,
    );
    assert.equal(loginCalls, 0);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("API explicitly fails closed when Redis is unavailable for high-risk routes", async () => {
  const rateLimiter: RateLimiter = {
    async consume(bucket) {
      return { allowed: false, available: false, retryAfterSeconds: 1, bucket };
    },
    async ping() {
      throw new Error("unavailable");
    },
    async close() {},
  };
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    rateLimiter,
  });
  const port = await listen(server);

  try {
    const response = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/tasks`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
      body: {},
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers["retry-after"], "1");
    assert.equal(
      (response.body as { error: { code: string } }).error.code,
      "SERVICE_UNAVAILABLE",
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("API rate limit scopes use trusted session identities and reuse the session lookup", async () => {
  const authService = createFakeAuthService();
  const getSession = authService.getSession;
  let sessionLookups = 0;
  authService.getSession = async (context) => {
    sessionLookups += 1;
    return getSession(context);
  };
  const consumedScopes: string[][] = [];
  const rateLimiter: RateLimiter = {
    async consume(bucket, scopes) {
      consumedScopes.push(scopes);
      return { allowed: true, available: true, retryAfterSeconds: 0, bucket };
    },
    async ping() {},
    async close() {},
  };
  const server = await createFastifyApiServer({
    config,
    authService,
    rateLimiter,
  });
  const port = await listen(server);

  try {
    const response = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/auth/session`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(sessionLookups, 1);
    assert.equal(consumedScopes.length, 2);
    assert.deepEqual(consumedScopes[1], [
      "user:user_1",
      "workspace:workspace_1",
    ]);
    assert.equal(
      consumedScopes.flat().some((scope) => scope.includes("signed_session")),
      false,
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("register route issues a HttpOnly session cookie and auth response", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);

  try {
    const response = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/register`,
      body: {
        username: "Artist_01",
        email: "artist@example.com",
        password: "long-enough-password",
        acceptedTermsAndPrivacy: true,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.match(
      String(response.headers["set-cookie"]),
      new RegExp(`${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`),
    );
    assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
    assert.deepEqual(
      (response.body as AuthSuccessResponse).workspace.role,
      "owner",
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("login route preserves takeover conflicts until the client confirms", async () => {
  const baseAuthService = createFakeAuthService();
  const authService: AuthService = {
    ...baseAuthService,
    async login(input) {
      if (!input.force) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "ACTIVE_SESSION_EXISTS",
          message: "This account is already signed in on another device",
        });
      }

      return baseAuthService.login(input, { requestId: "forced-login" });
    },
  };
  const server = await createFastifyApiServer({ config, authService });
  const port = await listen(server);

  try {
    const conflict = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/login`,
      body: {
        identifier: "artist@example.com",
        password: "long-enough-password",
        deviceId: "device-b",
      },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(
      (conflict.body as { error: { code: string } }).error.code,
      "ACTIVE_SESSION_EXISTS",
    );

    const confirmed = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/login`,
      body: {
        identifier: "artist@example.com",
        password: "long-enough-password",
        deviceId: "device-b",
        force: true,
      },
    });
    assert.equal(confirmed.statusCode, 200);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("password reset routes request and consume email verification codes", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);

  try {
    const forgot = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/password/forgot`,
      body: { email: "artist@example.com" },
    });

    assert.equal(forgot.statusCode, 200);
    assert.deepEqual(forgot.body, { ok: true });

    const reset = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/password/reset`,
      body: {
        email: "artist@example.com",
        code: "123456",
        password: "new-long-enough-password",
      },
    });

    assert.equal(reset.statusCode, 200);
    assert.deepEqual(reset.body, { ok: true });
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("password change requires an authenticated session and current credentials", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);

  try {
    const missingSession = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/password/change`,
      body: {
        currentPassword: "long-enough-password",
        newPassword: "new-long-enough-password",
      },
    });
    assert.equal(missingSession.statusCode, 401);
    assert.equal(
      (missingSession.body as { error: { code: string } }).error.code,
      "AUTH_REQUIRED",
    );

    const changed = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/password/change`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
      body: {
        currentPassword: "long-enough-password",
        newPassword: "new-long-enough-password",
      },
    });
    assert.equal(changed.statusCode, 200);
    assert.deepEqual(changed.body, { ok: true });
    assert.match(
      Array.isArray(changed.headers["set-cookie"])
        ? changed.headers["set-cookie"].join("\n")
        : (changed.headers["set-cookie"] ?? ""),
      /changed_session/,
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("registration email-code route does not require a session", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);
  try {
    const response = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/auth/registration/email-code`,
      body: { email: "artist@example.com" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, resendAfterSeconds: 60 });
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("session route requires a session cookie and resolves the current workspace", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);

  try {
    const missingCookie = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/auth/session`,
    });

    assert.equal(missingCookie.statusCode, 401);
    assert.equal(
      (missingCookie.body as { error: { code: string } }).error.code,
      "AUTH_REQUIRED",
    );

    const session = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/auth/session`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    });

    assert.equal(session.statusCode, 200);
    assert.equal(
      (session.body as AuthSessionResponse).workspace.id,
      "workspace_1",
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("current workspace route requires auth and returns session workspace", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);

  try {
    const missingCookie = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/workspaces/current`,
    });

    assert.equal(missingCookie.statusCode, 401);
    assert.equal(
      (missingCookie.body as { error: { code: string } }).error.code,
      "AUTH_REQUIRED",
    );

    const current = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/workspaces/current`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    });

    assert.equal(current.statusCode, 200);
    assert.equal(
      (current.body as CurrentWorkspaceResponse).workspace.id,
      "workspace_1",
    );
    assert.equal(
      (current.body as CurrentWorkspaceResponse).workspace.role,
      "owner",
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("session management routes list and revoke active sessions", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;

  try {
    const list = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/auth/sessions`,
      cookie,
    });

    assert.equal(list.statusCode, 200);
    const sessions = list.body as AuthSessionsResponse;
    assert.equal(sessions.sessions.length, 2);
    assert.equal(sessions.sessions[0]?.current, true);

    const revoked = await requestJson(port, {
      method: "DELETE",
      path: `${API_V1_PREFIX}/auth/sessions/session_other`,
      cookie,
    });

    assert.equal(revoked.statusCode, 200);
    assert.deepEqual(revoked.body as RevokeSessionResponse, { ok: true });

    const missing = await requestJson(port, {
      method: "DELETE",
      path: `${API_V1_PREFIX}/auth/sessions/missing`,
      cookie,
    });

    assert.equal(missing.statusCode, 404);
    assert.equal(
      (missing.body as { error: { code: string } }).error.code,
      "RESOURCE_NOT_FOUND",
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("device management routes list history and remove an old device", async () => {
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;

  try {
    const list = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/auth/devices`,
      cookie,
    });

    assert.equal(list.statusCode, 200);
    const devices = list.body as AuthDevicesResponse;
    assert.equal(devices.devices.length, 2);
    assert.equal(devices.devices[0]?.current, true);

    const removed = await requestJson(port, {
      method: "DELETE",
      path: `${API_V1_PREFIX}/auth/devices/22222222-2222-4222-8222-222222222222`,
      cookie,
    });

    assert.equal(removed.statusCode, 200);
    assert.deepEqual(removed.body, { ok: true });
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("project metadata routes use the session actor for the complete lifecycle", async () => {
  const projects = createFakeProjectService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    projectService: projects.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const projectPath = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111`;

  try {
    const missingSession = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/projects`,
    });
    assert.equal(missingSession.statusCode, 401);

    const created = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/projects`,
      cookie,
      body: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "新项目",
        userId: "forged-user",
        workspaceId: "forged-workspace",
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(
      (created.body as ProjectResponse).project.id,
      "22222222-2222-4222-8222-222222222222",
    );
    assert.equal((created.body as ProjectResponse).project.name, "新项目");

    const listed = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/projects?status=active&limit=20`,
      cookie,
    });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.body as ProjectsResponse).projects.length, 1);

    assert.equal(
      (await requestJson(port, { method: "GET", path: projectPath, cookie }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "PATCH",
          path: projectPath,
          cookie,
          body: { name: "重命名" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${projectPath}/archive`,
          cookie,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${projectPath}/restore`,
          cookie,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await requestJson(port, { method: "DELETE", path: projectPath, cookie }))
        .statusCode,
      200,
    );

    assert.equal(projects.actors.length, 7);
    assert(
      projects.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("asset upload route uses the session actor and returns presigned upload metadata", async () => {
  const assets = createFakeAssetService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    assetService: assets.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;

  try {
    const missingSession = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/assets/uploads`,
      body: {
        originalFileName: "reference.png",
        mimeType: "image/png",
        byteSize: 2048,
        assetKind: "upload",
        idempotencyKey: "asset_upload_1",
      },
    });
    assert.equal(missingSession.statusCode, 401);

    const created = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/assets/uploads`,
      cookie,
      body: {
        projectId: "11111111-1111-4111-8111-111111111111",
        originalFileName: "reference.png",
        mimeType: "image/png",
        byteSize: 2048,
        assetKind: "upload",
        idempotencyKey: "asset_upload_1",
        userId: "forged-user",
        workspaceId: "forged-workspace",
      },
    });

    assert.equal(created.statusCode, 201);
    const body = created.body as AssetUploadResponse;
    assert.equal(body.directUpload.method, "PUT");
    assert.equal(body.upload.assetId, body.asset.id);
    assert.equal("workspaceId" in body.asset, false);
    assert.equal("objectKey" in body.asset, false);
    assert.deepEqual(assets.actors, [
      { userId: "user_1", workspaceId: "workspace_1" },
    ]);

    const completed = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/assets/uploads/55555555-5555-4555-8555-555555555555/complete?workspaceId=forged-workspace`,
      cookie,
    });

    assert.equal(completed.statusCode, 200);
    const completedBody = completed.body as CompleteAssetUploadResponse;
    assert.equal(completedBody.asset.status, "completed");
    assert.equal(completedBody.upload.status, "completed");
    assert.equal("objectKey" in completedBody.asset, false);
    assert.deepEqual(assets.actors, [
      { userId: "user_1", workspaceId: "workspace_1" },
      { userId: "user_1", workspaceId: "workspace_1" },
    ]);

    const assetId = "66666666-6666-4666-8666-666666666666";
    const metadata = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/assets/${assetId}?workspaceId=forged-workspace`,
      cookie,
    });
    assert.equal(metadata.statusCode, 200);
    assert.equal((metadata.body as AssetResponse).asset.id, assetId);
    assert.equal("objectKey" in (metadata.body as AssetResponse).asset, false);

    const readUrl = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/assets/${assetId}/url?userId=forged-user`,
      cookie,
    });
    assert.equal(readUrl.statusCode, 200);
    assert.equal((readUrl.body as AssetUrlResponse).assetId, assetId);
    assert.equal("headers" in (readUrl.body as AssetUrlResponse), false);
    assert(
      assets.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("current workspace usage route uses only the trusted session actor", async () => {
  const usage = createFakeWorkspaceUsageService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    workspaceUsageService: usage.service,
  });
  const port = await listen(server);

  try {
    const missingCookie = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/workspaces/current/usage`,
    });
    assert.equal(missingCookie.statusCode, 401);

    const response = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/workspaces/current/usage?workspaceId=forged&userId=forged`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      (response.body as WorkspaceUsageResponse).workspaceId,
      "workspace_1",
    );
    assert.equal(
      (response.body as WorkspaceUsageResponse).storage.quotaBytes,
      10 * 1024 * 1024 * 1024,
    );
    assert.equal(
      (response.body as WorkspaceUsageResponse).projects[0]?.storageBytes,
      1024,
    );
    assert.deepEqual(usage.actors, [
      { userId: "user_1", workspaceId: "workspace_1" },
    ]);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("generation telemetry route requires auth and uses only the session actor", async () => {
  const calls: Array<{ input: unknown; actor: ProjectActor }> = [];
  const generationTelemetryService: GenerationTelemetryService = {
    async record(rawInput, actor) {
      const input = validateGenerationTelemetryRequest(rawInput);
      calls.push({ input, actor });
      return {
        accepted: true,
        attemptId: input.attemptId,
        status: input.status,
      };
    },
  };
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    generationTelemetryService,
  });
  const port = await listen(server);
  const path = `${API_V1_PREFIX}/telemetry/generations?userId=forged&workspaceId=forged`;
  const body = {
    attemptId: "11111111-1111-4111-8111-111111111111",
    category: "image",
    status: "started",
  } as const;

  try {
    const missingSession = await requestJson(port, {
      method: "POST",
      path,
      body,
    });
    assert.equal(missingSession.statusCode, 401);

    const accepted = await requestJson(port, {
      method: "POST",
      path,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
      body,
    });
    assert.equal(accepted.statusCode, 202);
    assert.deepEqual(accepted.body, {
      accepted: true,
      attemptId: body.attemptId,
      status: "started",
    });
    assert.deepEqual(calls, [
      {
        input: body,
        actor: { userId: "user_1", workspaceId: "workspace_1" },
      },
    ]);

    const rejectedPrivateField = await requestJson(port, {
      method: "POST",
      path,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
      body: { ...body, model: "private-model" },
    });
    assert.equal(rejectedPrivateField.statusCode, 400);
    assert.equal(calls.length, 1);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("asset upload route preserves workspace quota error details", async () => {
  const baseAssetService = createFakeAssetService().service;
  const assetService: AssetService = {
    ...baseAssetService,
    async createUpload() {
      throw new AuthServiceError({
        statusCode: 409,
        apiCode: "QUOTA_EXCEEDED",
        message: "Workspace storage quota exceeded",
        details: {
          quotaBytes: 100,
          usedBytes: 60,
          reservedBytes: 40,
          availableBytes: 0,
          requestedBytes: 1,
        },
      });
    },
  };
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    assetService,
  });
  const port = await listen(server);

  try {
    const response = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/assets/uploads`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
      body: {
        originalFileName: "over-quota.png",
        mimeType: "image/png",
        byteSize: 1,
        assetKind: "upload",
        idempotencyKey: "quota-error",
      },
    });
    assert.equal(response.statusCode, 409);
    const error = (
      response.body as {
        error: { code: string; details: Record<string, unknown> };
      }
    ).error;
    assert.equal(error.code, "QUOTA_EXCEEDED");
    assert.equal(error.details.availableBytes, 0);
    assert.equal("workspaceId" in error.details, false);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("asset read routes preserve non-disclosing two-account isolation", async () => {
  const baseAuthService = createFakeAuthService();
  const authService: AuthService = {
    ...baseAuthService,
    async getSession(context) {
      if (context.cookieHeader?.includes("session_b")) {
        return {
          user: {
            id: "asset_user_b",
            userNumber: 10002,
            email: "asset-b@example.com",
            status: "active",
            emailVerified: true,
          },
          workspace: {
            id: "asset_workspace_b",
            type: "personal",
            name: "Asset B workspace",
            role: "owner",
            status: "active",
            planKey: "free",
          },
        };
      }

      if (context.cookieHeader?.includes("session_a")) {
        return {
          user: {
            id: "asset_user_a",
            userNumber: 10001,
            email: "asset-a@example.com",
            status: "active",
            emailVerified: true,
          },
          workspace: {
            id: "asset_workspace_a",
            type: "personal",
            name: "Asset A workspace",
            role: "owner",
            status: "active",
            planKey: "free",
          },
        };
      }

      throw new AuthServiceError({
        statusCode: 401,
        apiCode: "SESSION_EXPIRED",
        message: "Session expired",
      });
    },
  };
  const baseAssetService = createFakeAssetService().service;
  const requireOwner = (workspaceId: string) => {
    if (workspaceId !== "asset_workspace_b") {
      throw new AuthServiceError({
        statusCode: 404,
        apiCode: "RESOURCE_NOT_FOUND",
        message: "Asset not found",
      });
    }
  };
  const assetService: AssetService = {
    ...baseAssetService,
    async getAsset(assetId, actor) {
      requireOwner(actor.workspaceId);
      return baseAssetService.getAsset(assetId, actor);
    },
    async getAssetUrl(assetId, actor) {
      requireOwner(actor.workspaceId);
      return baseAssetService.getAssetUrl(assetId, actor);
    },
  };
  const server = await createFastifyApiServer({
    config,
    authService,
    assetService,
  });
  const port = await listen(server);
  const assetId = "66666666-6666-4666-8666-666666666666";
  const path = `${API_V1_PREFIX}/assets/${assetId}`;

  try {
    assert.equal(
      (await requestJson(port, { method: "GET", path })).statusCode,
      401,
    );

    for (const suffix of ["", "/url"]) {
      const crossAccount = await requestJson(port, {
        method: "GET",
        path: `${path}${suffix}`,
        cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_a`,
      });
      assert.equal(crossAccount.statusCode, 404);
      assert.equal(
        (crossAccount.body as { error: { code: string } }).error.code,
        "RESOURCE_NOT_FOUND",
      );

      const ownerRead = await requestJson(port, {
        method: "GET",
        path: `${path}${suffix}`,
        cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_b`,
      });
      assert.equal(ownerRead.statusCode, 200);
    }
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("project routes preserve non-disclosing two-account isolation", async () => {
  const baseAuthService = createFakeAuthService();
  const authService: AuthService = {
    ...baseAuthService,
    async getSession(context) {
      if (context.cookieHeader?.includes("session_b")) {
        return {
          user: {
            id: "user_b",
            userNumber: 10002,
            email: "b@example.com",
            status: "active",
            emailVerified: true,
          },
          workspace: {
            id: "workspace_b",
            type: "personal",
            name: "B workspace",
            role: "owner",
            status: "active",
            planKey: "free",
          },
        };
      }

      if (context.cookieHeader?.includes("session_a")) {
        return {
          user: {
            id: "user_a",
            userNumber: 10001,
            email: "a@example.com",
            status: "active",
            emailVerified: true,
          },
          workspace: {
            id: "workspace_a",
            type: "personal",
            name: "A workspace",
            role: "owner",
            status: "active",
            planKey: "free",
          },
        };
      }

      throw new AuthServiceError({
        statusCode: 401,
        apiCode: "SESSION_EXPIRED",
        message: "Session expired",
      });
    },
  };
  const projectService: ProjectService = {
    ...createFakeProjectService().service,
    async getProject(_projectId, actor) {
      if (actor.workspaceId !== "workspace_b") {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: "RESOURCE_NOT_FOUND",
          message: "Project not found",
        });
      }

      return createProjectResponse();
    },
  };
  const server = await createFastifyApiServer({
    config,
    authService,
    projectService,
  });
  const port = await listen(server);
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111`;

  try {
    const forbiddenCrossAccountRead = await requestJson(port, {
      method: "GET",
      path,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_a`,
    });
    assert.equal(forbiddenCrossAccountRead.statusCode, 404);
    assert.equal(
      (forbiddenCrossAccountRead.body as { error: { code: string } }).error
        .code,
      "RESOURCE_NOT_FOUND",
    );

    const ownerRead = await requestJson(port, {
      method: "GET",
      path,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_b`,
    });
    assert.equal(ownerRead.statusCode, 200);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("project graph routes use the session actor and preserve conflict details", async () => {
  const graphs = createFakeProjectGraphService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    projectGraphService: graphs.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/graph`;
  const operationBody = {
    baseVersion: 0,
    clientId: "browser_1",
    batchId: "batch_1",
    idempotencyKey: "graph_1",
    userId: "forged-user",
    workspaceId: "forged-workspace",
    operations: [{ type: "deleteNode", nodeId: "node_1" }],
  };

  try {
    const graph = await requestJson(port, { method: "GET", path, cookie });
    assert.equal(graph.statusCode, 200);
    assert.equal((graph.body as ProjectGraphResponse).version, 0);

    const changes = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/changes?after=0&user_id=forged-user&workspace_id=forged-workspace`,
      cookie,
    });
    assert.equal(changes.statusCode, 200);
    assert.equal((changes.body as ProjectGraphChangesResponse).after, 0);

    const invalidAfter = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/changes?after=-1`,
      cookie,
    });
    assert.equal(invalidAfter.statusCode, 400);

    const applied = await requestJson(port, {
      method: "PATCH",
      path,
      cookie,
      body: operationBody,
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(
      (applied.body as ApplyProjectGraphOperationsResponse).acceptedBatchId,
      "batch_1",
    );
    assert(
      graphs.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );

    const conflict = await requestJson(port, {
      method: "PATCH",
      path,
      cookie,
      body: {
        ...operationBody,
        baseVersion: 1,
        batchId: "batch_2",
        idempotencyKey: "graph_2",
      },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(
      (conflict.body as { error: { code: string } }).error.code,
      "PROJECT_VERSION_CONFLICT",
    );
    assert.equal(
      (conflict.body as { error: { details: { currentVersion: number } } })
        .error.details.currentVersion,
      1,
    );

    const pendingAsset = await requestJson(port, {
      method: "PATCH",
      path,
      cookie,
      body: {
        ...operationBody,
        batchId: "batch_asset_pending",
        idempotencyKey: "graph_asset_pending",
        operations: [
          {
            type: "upsertNode",
            node: {
              id: "node_asset",
              nodeType: "imageNode",
              position: { x: 0, y: 0 },
              dataSchemaVersion: 1,
              data: {
                imageAsset: { assetId: "44444444-4444-4444-8444-444444444444" },
              },
            },
          },
        ],
      },
    });
    assert.equal(pendingAsset.statusCode, 409);
    assert.equal(
      (pendingAsset.body as { error: { code: string } }).error.code,
      "ASSET_NOT_READY",
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("project checkpoint route uses the session actor and preserves version conflicts", async () => {
  const snapshots = createFakeProjectSnapshotService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/checkpoints`;

  try {
    const missingSession = await requestJson(port, {
      method: "POST",
      path,
      body: { expectedVersion: 1, expectedSequence: 1 },
    });
    assert.equal(missingSession.statusCode, 401);

    const created = await requestJson(port, {
      method: "POST",
      path,
      cookie,
      body: {
        expectedVersion: 1,
        expectedSequence: 1,
        userId: "forged-user",
        workspaceId: "forged-workspace",
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(
      (created.body as ProjectCheckpointResponse).checkpoint.snapshotType,
      "manual",
    );
    assert(
      snapshots.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );

    const periodic = await requestJson(port, {
      method: "POST",
      path,
      cookie,
      body: {
        expectedVersion: 1,
        expectedSequence: 1,
        checkpointType: "periodic",
      },
    });
    assert.equal(periodic.statusCode, 201);
    assert.equal(
      (periodic.body as ProjectCheckpointResponse).checkpoint.snapshotType,
      "periodic",
    );

    const conflict = await requestJson(port, {
      method: "POST",
      path,
      cookie,
      body: { expectedVersion: 0, expectedSequence: 0 },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(
      (conflict.body as { error: { code: string } }).error.code,
      "PROJECT_VERSION_CONFLICT",
    );
    assert.equal(
      (conflict.body as { error: { details: { currentSequence: number } } })
        .error.details.currentSequence,
      1,
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("project revisions route uses the session actor and returns checkpoint summaries", async () => {
  const snapshots = createFakeProjectSnapshotService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions?limit=1`;

  try {
    const missingSession = await requestJson(port, { method: "GET", path });
    assert.equal(missingSession.statusCode, 401);

    const listed = await requestJson(port, { method: "GET", path, cookie });
    assert.equal(listed.statusCode, 200);
    const body = listed.body as ProjectRevisionsResponse;
    assert.equal(body.revisions.length, 1);
    assert.equal(body.revisions[0]?.snapshotType, "manual");
    assert.equal(body.nextCursor, "cursor_1");
    assert.equal("recordJson" in body.revisions[0]!, false);
    assert(
      snapshots.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("project revision detail route uses the session actor and returns the saved record", async () => {
  const snapshots = createFakeProjectSnapshotService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/1`;

  try {
    const detail = await requestJson(port, { method: "GET", path, cookie });
    assert.equal(detail.statusCode, 200);
    const body = detail.body as ProjectRevisionResponse;
    assert.equal(body.checkpoint.projectVersion, 1);
    assert.deepEqual(body.record.canvas.nodes, []);
    assert(
      snapshots.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );

    const missing = await requestJson(port, {
      method: "GET",
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/2`,
      cookie,
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("project revision restore route uses the session actor and preserves conflicts", async () => {
  const snapshots = createFakeProjectSnapshotService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/1/restore`;

  try {
    const missingSession = await requestJson(port, {
      method: "POST",
      path,
      body: { expectedVersion: 2, expectedSequence: 2 },
    });
    assert.equal(missingSession.statusCode, 401);

    const restored = await requestJson(port, {
      method: "POST",
      path,
      cookie,
      body: {
        expectedVersion: 2,
        expectedSequence: 2,
        userId: "forged-user",
        workspaceId: "forged-workspace",
      },
    });
    assert.equal(restored.statusCode, 200);
    const body = restored.body as ProjectRevisionRestoreResponse;
    assert.equal(body.restoredCheckpoint.snapshotType, "manual");
    assert.equal(body.preRestoreCheckpoint.snapshotType, "pre_restore");
    assert.equal(body.version, 3);
    assert(
      snapshots.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );

    const conflict = await requestJson(port, {
      method: "POST",
      path,
      cookie,
      body: { expectedVersion: 1, expectedSequence: 1 },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(
      (conflict.body as { error: { code: string } }).error.code,
      "PROJECT_VERSION_CONFLICT",
    );
    assert.equal(
      (conflict.body as { error: { details: { currentSequence: number } } })
        .error.details.currentSequence,
      2,
    );

    const unavailableAsset = await requestJson(port, {
      method: "POST",
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/3/restore`,
      cookie,
      body: { expectedVersion: 2, expectedSequence: 2 },
    });
    assert.equal(unavailableAsset.statusCode, 409);
    assert.equal(
      (unavailableAsset.body as { error: { code: string } }).error.code,
      "ASSET_NOT_READY",
    );
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("migration import routes use the trusted session actor and expose resumable state", async () => {
  const migrations = createFakeMigrationImportService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    migrationImportService: migrations.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const preparePath = `${API_V1_PREFIX}/migrations/imports/prepare`;
  const importPath = `${API_V1_PREFIX}/migrations/imports/99999999-9999-4999-8999-999999999999`;

  try {
    const missingSession = await requestJson(port, {
      method: "POST",
      path: preparePath,
      body: { idempotencyKey: "prepare-1" },
    });
    assert.equal(missingSession.statusCode, 401);

    const prepared = await requestJson(port, {
      method: "POST",
      path: preparePath,
      cookie,
      body: { idempotencyKey: "prepare-1" },
    });
    assert.equal(prepared.statusCode, 201);
    assert.equal(
      (prepared.body as MigrationImportResponse).import.status,
      "prepared",
    );

    const restored = await requestJson(port, {
      method: "GET",
      path: `${importPath}?user_id=forged-user&workspace_id=forged-workspace`,
      cookie,
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(
      (restored.body as MigrationImportResponse).import.id,
      "99999999-9999-4999-8999-999999999999",
    );

    const committed = await requestJson(port, {
      method: "POST",
      path: `${importPath}/commit`,
      cookie,
      body: { idempotencyKey: "commit-1", strategy: "copy" },
    });
    assert.equal(committed.statusCode, 200);
    assert.equal((committed.body as { status: string }).status, "completed");

    const forgedCancel = await requestJson(port, {
      method: "POST",
      path: `${importPath}/cancel`,
      cookie,
      body: { userId: "forged-user", workspaceId: "forged-workspace" },
    });
    assert.equal(forgedCancel.statusCode, 400);

    const canceled = await requestJson(port, {
      method: "POST",
      path: `${importPath}/cancel`,
      cookie,
      body: {},
    });
    assert.equal(canceled.statusCode, 200);
    assert.equal(
      (canceled.body as MigrationImportResponse).import.status,
      "canceled",
    );
    assert(
      migrations.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
    assert.deepEqual(migrations.calls, [
      "prepare:prepare-1",
      "get:99999999-9999-4999-8999-999999999999",
      "commit:99999999-9999-4999-8999-999999999999",
      "cancel:99999999-9999-4999-8999-999999999999",
    ]);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("migration export routes use the trusted session actor and keep download metadata private", async () => {
  const exports = createFakeMigrationExportService();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    migrationExportService: exports.service,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const projectId = "11111111-1111-4111-8111-111111111111";
  const exportId = "88888888-8888-4888-8888-888888888888";
  const projectPath = `${API_V1_PREFIX}/projects/${projectId}/exports`;

  try {
    const missingSession = await requestJson(port, {
      method: "POST",
      path: `${projectPath}/prepare`,
      body: { idempotencyKey: "export-1" },
    });
    assert.equal(missingSession.statusCode, 401);
    const prepared = await requestJson(port, {
      method: "POST",
      path: `${projectPath}/prepare`,
      cookie,
      body: {
        idempotencyKey: "export-1",
        expectedVersion: 2,
        expectedSequence: 3,
      },
    });
    assert.equal(prepared.statusCode, 201);
    assert.equal(
      (prepared.body as MigrationExportResponse).export.id,
      exportId,
    );
    const status = await requestJson(port, {
      method: "GET",
      path: `${projectPath}/${exportId}`,
      cookie,
    });
    assert.equal(status.statusCode, 200);
    const download = await requestJson(port, {
      method: "GET",
      path: `${projectPath}/${exportId}/download`,
      cookie,
    });
    assert.equal(download.statusCode, 200);
    assert.equal(JSON.stringify(download.body).includes("objectKey"), false);
    const canceled = await requestJson(port, {
      method: "POST",
      path: `${projectPath}/${exportId}/cancel`,
      cookie,
      body: {},
    });
    assert.equal(canceled.statusCode, 200);
    assert.equal(
      (canceled.body as MigrationExportResponse).export.status,
      "canceled",
    );
    const retried = await requestJson(port, {
      method: "POST",
      path: `${projectPath}/${exportId}/retry`,
      cookie,
      body: {},
    });
    assert.equal(retried.statusCode, 200);
    assert.equal(
      (retried.body as MigrationExportResponse).export.status,
      "prepared",
    );
    assert(
      exports.actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
    assert.deepEqual(exports.calls, [
      `prepare:${projectId}:export-1`,
      `get:${projectId}:${exportId}`,
      `download:${projectId}:${exportId}`,
      `cancel:${projectId}:${exportId}`,
      `retry:${projectId}:${exportId}`,
    ]);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("migration asset upload routes use the trusted session actor and preserve upload boundaries", async () => {
  const actors: ProjectActor[] = [];
  const calls: string[] = [];
  const uploadResponse = (): MigrationImportAssetUploadResponse => ({
    upload: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      importId: "99999999-9999-4999-8999-999999999999",
      logicalAssetId: "asset-1",
      status: "uploading",
      mode: "multipart",
      expectedMimeType: "video/mp4",
      expectedByteSize: 16,
      expectedSha256: "a".repeat(64),
      partSize: 8,
      partCount: 2,
      completedParts: [],
      uploadedByteSize: 0,
      retryCount: 0,
      directUpload: null,
      parts: [
        {
          partNumber: 1,
          byteSize: 8,
          url: "https://storage.invalid/part/1",
          headers: { "content-length": "8" },
          expiresAt: "2026-07-19T00:00:00.000Z",
        },
      ],
      expiresAt: "2026-07-19T00:00:00.000Z",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  });
  const migrationAssetUploadService: MigrationAssetUploadService = {
    async prepareAssetUpload(importId, logicalAssetId, actor) {
      actors.push(actor);
      calls.push(`prepare:${importId}:${logicalAssetId}`);
      return uploadResponse();
    },
    async getAssetUpload(importId, logicalAssetId, actor) {
      actors.push(actor);
      calls.push(`get:${importId}:${logicalAssetId}`);
      return uploadResponse();
    },
    async completeAssetPart(
      importId,
      logicalAssetId,
      partNumber,
      input,
      actor,
    ) {
      actors.push(actor);
      calls.push(
        `part:${importId}:${logicalAssetId}:${partNumber}:${JSON.stringify(input)}`,
      );
      return uploadResponse();
    },
    async completeAssetUpload(importId, logicalAssetId, input, actor) {
      actors.push(actor);
      calls.push(
        `complete:${importId}:${logicalAssetId}:${JSON.stringify(input)}`,
      );
      return uploadResponse();
    },
    async cancelAssetUpload(importId, logicalAssetId, actor) {
      actors.push(actor);
      calls.push(`cancel:${importId}:${logicalAssetId}`);
      return uploadResponse();
    },
    async maintainStagingObjects() {
      return 0;
    },
  };
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    migrationAssetUploadService,
  });
  const port = await listen(server);
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`;
  const basePath = `${API_V1_PREFIX}/migrations/imports/99999999-9999-4999-8999-999999999999/assets/asset-1`;

  try {
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${basePath}/upload`,
          body: {},
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${basePath}/upload`,
          cookie,
          body: {},
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "GET",
          path: `${basePath}/upload`,
          cookie,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${basePath}/parts/1/complete`,
          cookie,
          body: { etag: "etag-1", byteSize: 8 },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${basePath}/complete`,
          cookie,
          body: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${basePath}/cancel`,
          cookie,
          body: { objectKey: "forged-object-key" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "POST",
          path: `${basePath}/cancel`,
          cookie,
          body: {},
        })
      ).statusCode,
      200,
    );
    assert(
      actors.every(
        (actor) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
    assert.deepEqual(calls, [
      "prepare:99999999-9999-4999-8999-999999999999:asset-1",
      "get:99999999-9999-4999-8999-999999999999:asset-1",
      'part:99999999-9999-4999-8999-999999999999:asset-1:1:{"etag":"etag-1","byteSize":8}',
      "complete:99999999-9999-4999-8999-999999999999:asset-1:{}",
      "cancel:99999999-9999-4999-8999-999999999999:asset-1",
    ]);
  } finally {
    await closeApiServer(server, 1_000);
  }
});

test("observability records bounded API metrics and readiness failure recovery", async () => {
  let redisUp = false;
  const metrics = createMetricsRegistry();
  const server = await createFastifyApiServer({
    config,
    authService: createFakeAuthService(),
    metrics,
    postgresPoolStats: () => ({ total: 4, idle: 3, waiting: 1 }),
    readinessChecks: {
      async postgres() {},
      async redis() {
        if (!redisUp) throw new Error("redis://user:secret@private.example");
      },
      async objectStorage() {},
    },
  });
  const port = await listen(server);
  try {
    const degraded = await requestJson(port, {
      method: "GET",
      path: "/health/ready",
    });
    assert.equal(degraded.statusCode, 503);
    assert.equal((degraded.body as { status: string }).status, "degraded");
    assert.equal(
      (degraded.body as { dependencies: { redis: { error: string } } })
        .dependencies.redis.error,
      "unknown",
    );
    assert.doesNotMatch(
      JSON.stringify(degraded.body),
      /secret|private\.example/,
    );

    redisUp = true;
    assert.equal(
      (await requestJson(port, { method: "GET", path: "/health/ready" }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "GET",
          path: `${API_V1_PREFIX}/auth/session`,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await requestJson(port, { method: "GET", path: "/not-a-route" }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await requestJson(port, {
          method: "GET",
          path: `${API_V1_PREFIX}/attacker-chosen-route`,
        })
      ).statusCode,
      404,
    );

    const exposed = await requestText(port, "/metrics");
    assert.equal(exposed.statusCode, 200);
    assert.match(
      exposed.body,
      /ai_canvas_dependency_up\{dependency="redis"\} 1/,
    );
    assert.match(
      exposed.body,
      /ai_canvas_postgres_pool_connections\{state="waiting"\} 1/,
    );
    assert.match(
      exposed.body,
      /ai_canvas_api_auth_failures_total\{route="\/api\/v1\/auth",status_class="4xx"\} 1/,
    );
    assert.match(
      exposed.body,
      /ai_canvas_api_request_duration_seconds_count\{route="\/health\/ready"\} 2/,
    );
    assert.doesNotMatch(
      exposed.body,
      /secret|private\.example|requestId|workspace|user_1/,
    );
    assert.doesNotMatch(exposed.body, /attacker-chosen-route/);
  } finally {
    await closeApiServer(server, 1_000);
  }
});
