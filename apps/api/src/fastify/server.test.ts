import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMetricsRegistry } from "@ai-canvas-cloud/shared";
import { DEFAULT_SITE_CONFIG } from "@ai-canvas-cloud/contracts/site-config";
import type {
  AssetCleanupSummary,
  AssetResponse,
  AssetUploadResponse,
  AssetUrlResponse,
  AuthSessionResponse,
  CompleteAssetUploadResponse,
  MigrationExportResponse,
  MigrationImportAssetUploadResponse,
  MigrationImportResponse,
  ProjectCheckpointResponse,
  ProjectGraphChangesResponse,
  ProjectGraphResponse,
  ProjectResponse,
  ProjectRevisionResponse,
  ProjectRevisionRestoreResponse,
  ProjectRevisionsResponse,
  ProjectsResponse,
} from "@ai-canvas-cloud/contracts";
import type {
  AssetCleanupService,
  AssetService,
} from "@ai-canvas-cloud/server/modules/assets";
import {
  createUnavailableAuthService,
  type AuthRequestContext,
  type AuthService,
} from "@ai-canvas-cloud/server/modules/auth";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { WorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
import type {
  MigrationAssetUploadService,
  MigrationExportService,
  MigrationImportService,
} from "@ai-canvas-cloud/server/modules/migrations";
import type { ProjectGraphService } from "@ai-canvas-cloud/server/modules/project-graph";
import type { ProjectSnapshotService } from "@ai-canvas-cloud/server/modules/project-snapshots";
import type {
  ProjectActor,
  ProjectService,
} from "@ai-canvas-cloud/server/modules/projects";
import {
  validateGenerationTelemetryRequest,
  type GenerationTelemetryService,
} from "@ai-canvas-cloud/server/modules/generation-telemetry";
import type { ApiConfig } from "../config.ts";
import type { RateLimiter } from "../rateLimit.ts";
import {
  closeApiServer,
  createApiServer,
  type ServerOptions,
} from "../../dist/server.js";
import { createFastifyApiServer } from "../../dist/fastify/server.js";

const config: ApiConfig = {
  env: "test",
  httpAdapter: "legacy",
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
  objectStorageEnvironmentFallback: true,
  s3Endpoint: "http://localhost:9000",
  s3PublicEndpoint: "http://localhost:9000",
  s3PublicOrigin: "http://localhost:9000",
  s3ForcePathStyle: true,
  s3Bucket: "ai-canvas-cloud",
  s3Region: "local",
  s3AccessKeyId: "test",
  s3SecretAccessKey: "test",
  objectStorageCredentialActiveKeyVersion: 1,
  assetMaintenanceToken: "asset-maintenance-token-for-tests-123456",
  devSeedAdmin: false,
  devSeedAdminUsername: "admin_user",
  devSeedAdminEmail: "admin@example.com",
  authEmailTransport: "development",
  smtpSecure: false,
  smtpCredentialActiveKeyVersion: 1,
};

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function request(
  port: number,
  path: string,
  method = "GET",
  headers: http.OutgoingHttpHeaders = {},
  body?: string | Buffer,
) {
  return new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const outgoing = http.request(
      { host: "127.0.0.1", port, path, method, headers },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            statusCode: incoming.statusCode ?? 0,
            headers: incoming.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function jsonHeaders(body: string | Buffer) {
  return {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  };
}

function normalizeError(text: string) {
  const payload = JSON.parse(text) as { error: Record<string, unknown> };
  Reflect.deleteProperty(payload.error, "requestId");
  return payload;
}

function normalizeHealth(text: string) {
  const payload = JSON.parse(text) as Record<string, unknown>;
  Reflect.deleteProperty(payload, "requestId");
  Reflect.deleteProperty(payload, "checkedAt");
  Reflect.deleteProperty(payload, "uptimeSeconds");
  const dependencies = payload.dependencies as
    Record<string, Record<string, unknown>> | undefined;
  for (const dependency of Object.values(dependencies ?? {})) {
    Reflect.deleteProperty(dependency, "latencyMs");
  }
  return payload;
}

function createWorkspaceServices() {
  const contexts: AuthRequestContext[] = [];
  const actors: Array<{ userId: string; workspaceId: string }> = [];
  const session: AuthSessionResponse = {
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
      name: "Artist workspace",
      role: "owner",
      status: "active",
      planKey: "free",
    },
  };
  const authService: AuthService = {
    ...createUnavailableAuthService(),
    async getSession(context) {
      contexts.push(context);
      return session;
    },
  };
  const workspaceUsageService: WorkspaceUsageService = {
    async getCurrentUsage(actor) {
      actors.push(actor);
      return {
        workspaceId: actor.workspaceId,
        storage: {
          usedBytes: 1024,
          reservedBytes: 512,
          totalBytes: 1536,
          quotaBytes: 10_737_418_240,
          availableBytes: 10_737_416_704,
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
  return { actors, authService, contexts, workspaceUsageService };
}

function createTelemetryServices() {
  const auth = createWorkspaceServices();
  const calls: Array<{
    input: unknown;
    actor: { userId: string; workspaceId: string };
  }> = [];
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
  return { ...auth, calls, generationTelemetryService };
}

function createAssetServices() {
  const auth = createWorkspaceServices();
  const calls: Array<{
    method: string;
    input: unknown;
    actor: { userId: string; workspaceId: string };
  }> = [];
  const uploadId = "55555555-5555-4555-8555-555555555555";
  const assetId = "66666666-6666-4666-8666-666666666666";
  const asset = (status: "pending" | "completed") => ({
    id: assetId,
    projectId: "11111111-1111-4111-8111-111111111111",
    originalFileName: "reference.png",
    mimeType: "image/png",
    byteSize: 2048,
    sha256: null,
    width: null,
    height: null,
    assetKind: "upload" as const,
    status,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:10:00.000Z",
  });
  const upload = (status: "pending" | "completed") => ({
    id: uploadId,
    assetId,
    projectId: "11111111-1111-4111-8111-111111111111",
    originalFileName: "reference.png",
    expectedMimeType: "image/png",
    expectedByteSize: 2048,
    expectedSha256: null,
    assetKind: "upload" as const,
    status,
    expiresAt: "2026-07-15T00:15:00.000Z",
    createdAt: "2026-07-15T00:00:00.000Z",
  });
  const assetService: AssetService = {
    async createUpload(input, actor): Promise<AssetUploadResponse> {
      calls.push({ method: "create", input, actor });
      if (input.originalFileName === "quota.png") {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "QUOTA_EXCEEDED",
          message: "Workspace storage quota exceeded",
          details: { availableBytes: 0, requestedBytes: input.byteSize },
        });
      }
      return {
        upload: upload("pending"),
        asset: asset("pending"),
        directUpload: {
          method: "PUT",
          url: "http://localhost:9000/presigned-upload",
          headers: { "content-type": input.mimeType },
          expiresAt: "2026-07-15T00:15:00.000Z",
        },
      };
    },
    async completeUpload(input, actor): Promise<CompleteAssetUploadResponse> {
      calls.push({ method: "complete", input, actor });
      return { upload: upload("completed"), asset: asset("completed") };
    },
    async getAsset(input, actor): Promise<AssetResponse> {
      calls.push({ method: "get", input, actor });
      return { asset: { ...asset("completed"), id: input } };
    },
    async getAssetUrl(input, actor): Promise<AssetUrlResponse> {
      calls.push({ method: "url", input, actor });
      return {
        assetId: input,
        url: "http://localhost:9000/presigned-read",
        expiresAt: "2026-07-15T00:15:00.000Z",
      };
    },
  };
  return { ...auth, assetId, assetService, calls, uploadId };
}

function createAssetCleanupServices() {
  const calls: boolean[] = [];
  const assetCleanupService: AssetCleanupService = {
    async run(input): Promise<AssetCleanupSummary> {
      calls.push(input.apply);
      if (input.apply) throw new Error("cleanup failed");
      return {
        mode: "preview",
        graceHours: 168,
        cutoff: "2026-07-22T00:00:00.000Z",
        scannedAssetCount: 2,
        reclaimableObjectCount: 1,
        reclaimableBytes: 42,
        deletedObjectCount: 0,
        deletedBytes: 0,
        missingObjectCount: 0,
        finalizedMissingAssetCount: 0,
        retainedAssetCount: 1,
        truncated: false,
        completedAt: "2026-07-29T00:00:00.000Z",
      };
    },
  };
  return { assetCleanupService, calls };
}

function createMigrationServices() {
  const auth = createWorkspaceServices();
  const calls: Array<{
    method: string;
    input?: unknown;
    actor: { userId: string; workspaceId: string };
  }> = [];
  const importId = "99999999-9999-4999-8999-999999999999";
  const projectId = "11111111-1111-4111-8111-111111111111";
  const exportId = "88888888-8888-4888-8888-888888888888";
  const logicalAssetId = "asset-1";
  const importResponse = (): MigrationImportResponse => ({
    import: {
      id: importId,
      status: "prepared",
      packageId: "package-1",
      sourcePlatform: "electron",
      project: {
        sourceId: projectId,
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
        assetCount: 1,
        fileCount: 4,
        totalBytes: 128,
        estimatedStorageBytes: 16,
        availableBytesAtPrepare: 1024,
      },
      progress: { completedFileCount: 0, completedBytes: 0, retryCount: 0 },
      uploads: [],
      error: null,
      cancelRequestedAt: null,
      expiresAt: "2026-07-31T00:00:00.000Z",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
  });
  const uploadResponse = (): MigrationImportAssetUploadResponse => ({
    upload: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      importId,
      logicalAssetId,
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
          expiresAt: "2026-07-31T00:00:00.000Z",
        },
      ],
      expiresAt: "2026-07-31T00:00:00.000Z",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
  });
  const exportResponse = (): MigrationExportResponse => ({
    export: {
      id: exportId,
      status: "prepared",
      project: {
        id: projectId,
        name: "Export project",
        version: 2,
        sequence: 3,
      },
      progress: {
        fileCount: 4,
        completedFileCount: 0,
        totalBytes: 512,
        completedBytes: 0,
        retryCount: 0,
      },
      archive: null,
      error: null,
      cancelRequestedAt: null,
      expiresAt: "2026-07-31T00:00:00.000Z",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
  });
  const capture = (
    method: string,
    actor: { userId: string; workspaceId: string },
    input?: unknown,
  ) => calls.push({ method, actor, input });
  const migrationImportService: MigrationImportService = {
    async prepareImport(input, actor) {
      capture("import.prepare", actor, input);
      return importResponse();
    },
    async getImport(id, actor) {
      capture("import.get", actor, id);
      return importResponse();
    },
    async cancelImport(id, actor) {
      capture("import.cancel", actor, id);
      return importResponse();
    },
    async commitImport(id, input, actor) {
      capture("import.commit", actor, { id, input });
      return {
        importId: id,
        status: "completed",
        strategy: "copy",
        project: {
          id: projectId,
          name: "Imported project",
          version: 1,
          sequence: 1,
        },
        assetCount: 1,
        checkpoint: null,
      };
    },
  };
  const migrationAssetUploadService: MigrationAssetUploadService = {
    async prepareAssetUpload(id, assetId, actor) {
      capture("asset.prepare", actor, { id, assetId });
      return uploadResponse();
    },
    async getAssetUpload(id, assetId, actor) {
      capture("asset.get", actor, { id, assetId });
      return uploadResponse();
    },
    async completeAssetPart(id, assetId, part, input, actor) {
      capture("asset.part", actor, { id, assetId, part, input });
      return uploadResponse();
    },
    async completeAssetUpload(id, assetId, input, actor) {
      capture("asset.complete", actor, { id, assetId, input });
      return uploadResponse();
    },
    async cancelAssetUpload(id, assetId, actor) {
      capture("asset.cancel", actor, { id, assetId });
      return uploadResponse();
    },
    async maintainStagingObjects() {
      return 0;
    },
  };
  const migrationExportService: MigrationExportService = {
    async prepareExport(id, input, actor) {
      capture("export.prepare", actor, { id, input });
      return exportResponse();
    },
    async getExport(id, value, actor) {
      if (value === "explode") throw new Error("private export failure");
      capture("export.get", actor, { id, value });
      return exportResponse();
    },
    async downloadExport(id, value, actor) {
      capture("export.download", actor, { id, value });
      return {
        exportId: value,
        url: "https://storage.invalid/signed-export",
        expiresAt: "2026-07-30T00:05:00.000Z",
      };
    },
    async cancelExport(id, value, actor) {
      capture("export.cancel", actor, { id, value });
      return exportResponse();
    },
    async retryExport(id, value, actor) {
      capture("export.retry", actor, { id, value });
      return exportResponse();
    },
    async processExport() {},
    async recoverExports() {},
    async maintainExports() {
      return 0;
    },
  };
  return {
    ...auth,
    calls,
    exportId,
    importId,
    logicalAssetId,
    migrationAssetUploadService,
    migrationExportService,
    migrationImportService,
    projectId,
  };
}

function createProjectServices() {
  const auth = createWorkspaceServices();
  const projectId = "11111111-1111-4111-8111-111111111111";
  const checkpointId = "33333333-3333-4333-8333-333333333333";
  const calls: Array<{
    method: string;
    input?: unknown;
    actor: ProjectActor;
  }> = [];
  const capture = (method: string, actor: ProjectActor, input?: unknown) =>
    calls.push({ method, actor, input });
  const project = (overrides: Partial<ProjectResponse["project"]> = {}) => ({
    id: projectId,
    name: "Project",
    version: 2,
    lastSequence: 3,
    nodeCount: 0,
    edgeCount: 0,
    taskCount: 0,
    archivedAt: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T01:00:00.000Z",
    ...overrides,
  });
  const checkpoint = (version = 2) => ({
    id: checkpointId,
    projectId,
    projectVersion: version,
    lastSequence: 3,
    snapshotType: "manual" as const,
    schemaVersion: 1,
    byteSize: 128,
    isValid: true,
    createdAt: "2026-07-30T02:00:00.000Z",
  });
  const graphNode = {
    id: "node-1",
    nodeType: "text",
    position: { x: 12, y: 24 },
    size: { width: 320, height: 180 },
    zIndex: 2,
    parentNodeId: null,
    dataSchemaVersion: 1,
    data: { text: "hello", nested: { visible: true } },
    presentation: { selected: false },
  };
  const graphEdge = {
    id: "edge-1",
    source: "node-1",
    target: "node-2",
    sourceHandle: null,
    targetHandle: "input",
    edgeType: "default",
    data: { animated: true },
  };

  const projectService: ProjectService = {
    async listProjects(input, actor): Promise<ProjectsResponse> {
      capture("project.list", actor, input);
      return { projects: [project()], nextCursor: "next-project" };
    },
    async createProject(input, actor): Promise<ProjectResponse> {
      capture("project.create", actor, input);
      return {
        project: project({ id: input.id ?? projectId, name: input.name }),
      };
    },
    async getProject(id, actor): Promise<ProjectResponse> {
      capture("project.get", actor, id);
      return { project: project() };
    },
    async renameProject(id, input, actor): Promise<ProjectResponse> {
      capture("project.rename", actor, { id, input });
      return { project: project({ name: input.name }) };
    },
    async archiveProject(id, actor): Promise<ProjectResponse> {
      capture("project.archive", actor, id);
      return { project: project({ archivedAt: "2026-07-30T03:00:00.000Z" }) };
    },
    async restoreProject(id, actor): Promise<ProjectResponse> {
      capture("project.restore", actor, id);
      return { project: project() };
    },
    async deleteProject(id, actor) {
      capture("project.delete", actor, id);
      return { ok: true };
    },
  };

  const projectGraphService: ProjectGraphService = {
    async getGraph(id, actor): Promise<ProjectGraphResponse> {
      capture("graph.get", actor, id);
      return {
        projectId,
        version: 2,
        sequence: 3,
        nodes: [graphNode],
        edges: [graphEdge],
      };
    },
    async getChanges(id, after, actor): Promise<ProjectGraphChangesResponse> {
      capture("graph.changes", actor, { id, after });
      return {
        projectId,
        version: 2,
        sequence: 3,
        after,
        changes: [
          {
            sequence: 3,
            baseVersion: 1,
            resultVersion: 2,
            clientId: "client-1",
            batchId: "batch-1",
            source: "user",
            operations: [{ type: "upsertNode", node: graphNode }],
            createdAt: "2026-07-30T01:00:00.000Z",
          },
        ],
        hasMore: false,
      };
    },
    async applyOperations(id, input, actor) {
      capture("graph.apply", actor, { id, input });
      if (input.baseVersion === 99) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "PROJECT_VERSION_CONFLICT",
          message: "Project was updated by another client",
          details: { currentVersion: 2, currentSequence: 3 },
        });
      }
      return {
        projectId,
        version: 3,
        sequence: 4,
        acceptedBatchId: input.batchId,
        updatedAt: "2026-07-30T04:00:00.000Z",
      };
    },
  };

  const projectSnapshotService: ProjectSnapshotService = {
    async listRevisions(id, input, actor): Promise<ProjectRevisionsResponse> {
      capture("revision.list", actor, { id, input });
      return { revisions: [checkpoint()], nextCursor: "next-revision" };
    },
    async getRevision(id, version, actor): Promise<ProjectRevisionResponse> {
      capture("revision.get", actor, { id, version });
      return {
        checkpoint: checkpoint(version),
        record: {
          schemaVersion: 1,
          project: { id: projectId, name: "Project", version, lastSequence: 3 },
          canvas: { nodes: [graphNode], edges: [graphEdge] },
          taskQueue: { tasks: [] },
        },
      };
    },
    async createCheckpoint(
      id,
      input,
      actor,
    ): Promise<ProjectCheckpointResponse> {
      capture("revision.checkpoint", actor, { id, input });
      return {
        checkpoint: checkpoint(input.expectedVersion),
        project: project(),
      };
    },
    async restoreRevision(
      id,
      version,
      input,
      actor,
    ): Promise<ProjectRevisionRestoreResponse> {
      capture("revision.restore", actor, { id, version, input });
      return {
        restoredCheckpoint: checkpoint(version),
        preRestoreCheckpoint: {
          ...checkpoint(2),
          id: "44444444-4444-4444-8444-444444444444",
          snapshotType: "pre_restore",
        },
        project: project({ version: 3, lastSequence: 4 }),
        version: 3,
        sequence: 4,
      };
    },
  };

  return {
    ...auth,
    calls,
    projectGraphService,
    projectId,
    projectService,
    projectSnapshotService,
  };
}

function createAuthLifecycleServices() {
  const base = createWorkspaceServices();
  const calls: Array<{
    method: string;
    input?: unknown;
    context: AuthRequestContext;
  }> = [];
  const success = {
    user: {
      id: "user_1",
      userNumber: 10001,
      username: "Artist_01",
      email: "artist@example.com",
      status: "active" as const,
      emailVerified: true,
    },
    workspace: {
      id: "workspace_1",
      type: "personal" as const,
      name: "Artist workspace",
      role: "owner" as const,
      status: "active" as const,
      planKey: "free",
    },
    session: { expiresAt: "2026-08-30T00:00:00.000Z" },
  };
  const authService: AuthService = {
    ...base.authService,
    async register(input, context) {
      calls.push({ method: "register", input, context });
      return {
        response: success,
        setCookieHeaders: [
          "better-auth.session_token=registered; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async login(input, context) {
      calls.push({ method: "login", input, context });
      if (input.identifier === "conflict") {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "SESSION_TAKEOVER_REQUIRED",
          message: "Another device is active",
          details: { activeDevice: "Other Browser" },
        });
      }
      return {
        response: success,
        setCookieHeaders: [
          "better-auth.session_token=logged-in; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async logout(context) {
      calls.push({ method: "logout", context });
      return {
        setCookieHeaders: [
          "better-auth.session_token=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async listSessions(context) {
      calls.push({ method: "listSessions", context });
      return {
        sessions: [
          {
            id: "session_current",
            deviceLabel: "Test Browser",
            createdAt: "2026-07-01T00:00:00.000Z",
            lastUsedAt: "2026-07-30T00:00:00.000Z",
            expiresAt: "2026-08-30T00:00:00.000Z",
            current: true,
          },
        ],
      };
    },
    async listDevices(context) {
      calls.push({ method: "listDevices", context });
      return {
        devices: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            deviceLabel: "Test Browser",
            firstSeenAt: "2026-07-01T00:00:00.000Z",
            lastSeenAt: "2026-07-30T00:00:00.000Z",
            current: true,
          },
        ],
      };
    },
    async sendRegistrationEmailCode(input, context) {
      calls.push({ method: "registrationCode", input, context });
      return { ok: true, resendAfterSeconds: 60 };
    },
    async requestPasswordReset(input, context) {
      calls.push({ method: "passwordForgot", input, context });
      return { ok: true };
    },
    async resetPassword(input, context) {
      calls.push({ method: "passwordReset", input, context });
      return { ok: true };
    },
    async changePassword(input, context) {
      calls.push({ method: "passwordChange", input, context });
      return {
        response: { ok: true },
        setCookieHeaders: [
          "better-auth.session_token=changed; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async revokeSession(sessionId, context) {
      calls.push({ method: "revokeSession", input: sessionId, context });
      return {
        response: { ok: true },
        setCookieHeaders: [
          "better-auth.session_token=current; HttpOnly; Path=/; SameSite=Lax",
        ],
      };
    },
    async removeDevice(deviceId, context) {
      calls.push({ method: "removeDevice", input: deviceId, context });
      return { ok: true };
    },
  };
  return { ...base, authService, calls };
}

test("Fastify system routes preserve legacy status, headers, and payloads", async () => {
  const etag = `"${"a".repeat(64)}"`;
  const baseOptions: ServerOptions = {
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
    readinessChecks: {
      async postgres() {},
      async redis() {},
      async objectStorage() {},
    },
  };
  const legacy = createApiServer({
    ...baseOptions,
    metrics: createMetricsRegistry(),
  });
  const fastifyMetrics = createMetricsRegistry();
  const fastify = await createFastifyApiServer({
    ...baseOptions,
    metrics: fastifyMetrics,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    for (const path of [
      "/health/live",
      "/api/v1/health/live",
      "/health/ready",
      "/api/v1/health/ready",
    ]) {
      const [before, after] = await Promise.all([
        request(legacyPort, path),
        request(fastifyPort, path),
      ]);
      assert.equal(after.statusCode, before.statusCode, path);
      assert.equal(
        after.headers["content-type"],
        before.headers["content-type"],
      );
      assert.equal(after.headers["x-content-type-options"], "nosniff");
      assert.deepEqual(
        normalizeHealth(after.text),
        normalizeHealth(before.text),
      );
    }

    const [legacySiteConfig, fastifySiteConfig] = await Promise.all([
      request(legacyPort, "/api/v1/site-config"),
      request(fastifyPort, "/api/v1/site-config"),
    ]);
    assert.equal(fastifySiteConfig.statusCode, legacySiteConfig.statusCode);
    assert.equal(fastifySiteConfig.text, legacySiteConfig.text);
    assert.equal(
      fastifySiteConfig.headers["content-type"],
      legacySiteConfig.headers["content-type"],
    );
    assert.equal(fastifySiteConfig.headers.etag, legacySiteConfig.headers.etag);
    assert.equal(
      fastifySiteConfig.headers["cache-control"],
      legacySiteConfig.headers["cache-control"],
    );

    const [legacyCached, fastifyCached] = await Promise.all([
      request(legacyPort, "/api/v1/site-config", "GET", {
        "if-none-match": etag,
      }),
      request(fastifyPort, "/api/v1/site-config", "GET", {
        "if-none-match": etag,
      }),
    ]);
    assert.equal(fastifyCached.statusCode, legacyCached.statusCode);
    assert.equal(fastifyCached.text, legacyCached.text);
    assert.equal(fastifyCached.headers.etag, legacyCached.headers.etag);
    assert.equal(
      fastifyCached.headers["cache-control"],
      legacyCached.headers["cache-control"],
    );

    const wrongMethod = await request(fastifyPort, "/health/live", "POST");
    assert.equal(wrongMethod.statusCode, 404);
    assert.equal(
      (JSON.parse(wrongMethod.text) as { error: { code: string } }).error.code,
      "SERVICE_UNAVAILABLE",
    );
    assert.equal(
      (await request(fastifyPort, "/api/v1/not-migrated")).statusCode,
      404,
    );
    assert.equal(
      (await request(fastifyPort, "/health/live", "OPTIONS")).statusCode,
      204,
    );
    const metrics = await request(fastifyPort, "/metrics");
    assert.match(
      metrics.text,
      /ai_canvas_api_requests_total\{method="OPTIONS",route="\/health\/live",status_class="2xx"\} 1/,
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify site configuration preserves legacy unavailable errors", async () => {
  const options: ServerOptions = {
    config,
    siteConfigService: {
      async getCurrent() {
        throw new Error("unavailable");
      },
    },
  };
  const legacy = createApiServer(options);
  const fastify = await createFastifyApiServer(options);
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    const [before, after] = await Promise.all([
      request(legacyPort, "/api/v1/site-config"),
      request(fastifyPort, "/api/v1/site-config"),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.headers["content-type"], before.headers["content-type"]);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify workspace routes preserve legacy auth context and trusted actors", async () => {
  const legacyServices = createWorkspaceServices();
  const fastifyServices = createWorkspaceServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const headers = {
    cookie: "better-auth.session_token=signed_session",
    "user-agent": "workspace-contract-test",
  };

  try {
    const [legacyAnonymous, fastifyAnonymous] = await Promise.all([
      request(legacyPort, "/api/v1/workspaces/current"),
      request(fastifyPort, "/api/v1/workspaces/current"),
    ]);
    assert.equal(fastifyAnonymous.statusCode, legacyAnonymous.statusCode);
    assert.deepEqual(
      normalizeError(fastifyAnonymous.text),
      normalizeError(legacyAnonymous.text),
    );

    for (const path of [
      "/api/v1/workspaces/current?workspaceId=forged",
      "/api/v1/workspaces/current/usage?workspaceId=forged&userId=forged",
    ]) {
      const [before, after] = await Promise.all([
        request(legacyPort, path, "GET", headers),
        request(fastifyPort, path, "GET", headers),
      ]);
      assert.equal(after.statusCode, before.statusCode, path);
      assert.equal(
        after.headers["content-type"],
        before.headers["content-type"],
      );
      assert.equal(after.text, before.text, path);
    }

    assert.deepEqual(fastifyServices.actors, legacyServices.actors);
    assert.deepEqual(fastifyServices.actors, [
      { userId: "user_1", workspaceId: "workspace_1" },
    ]);
    assert.equal(fastifyServices.contexts.length, 2);
    assert.equal(
      fastifyServices.contexts[0]?.cookieHeader,
      legacyServices.contexts[0]?.cookieHeader,
    );
    assert.equal(
      fastifyServices.contexts[0]?.userAgent,
      legacyServices.contexts[0]?.userAgent,
    );
    assert.equal(
      fastifyServices.contexts[0]?.ipAddress,
      legacyServices.contexts[0]?.ipAddress,
    );
    assert.match(fastifyServices.contexts[0]?.requestId ?? "", /^[\w-]+$/);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify workspace rate limits preserve legacy trusted scopes", async () => {
  function createRateLimiter() {
    const calls: Array<{ bucket: string; scopes: string[] }> = [];
    const rateLimiter: RateLimiter = {
      async consume(bucket, scopes) {
        calls.push({ bucket, scopes });
        return scopes.some((scope) => scope.startsWith("user:"))
          ? {
              allowed: false,
              available: true,
              retryAfterSeconds: 17,
              bucket,
            }
          : { allowed: true, available: true, retryAfterSeconds: 0, bucket };
      },
      async ping() {},
      async close() {},
    };
    return { calls, rateLimiter };
  }

  const legacyServices = createWorkspaceServices();
  const fastifyServices = createWorkspaceServices();
  const legacyLimit = createRateLimiter();
  const fastifyLimit = createRateLimiter();
  const legacy = createApiServer({
    config,
    ...legacyServices,
    rateLimiter: legacyLimit.rateLimiter,
  });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
    rateLimiter: fastifyLimit.rateLimiter,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    const headers = { cookie: "better-auth.session_token=signed_session" };
    const [before, after] = await Promise.all([
      request(legacyPort, "/api/v1/workspaces/current", "GET", headers),
      request(fastifyPort, "/api/v1/workspaces/current", "GET", headers),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.headers["retry-after"], before.headers["retry-after"]);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    assert.deepEqual(fastifyLimit.calls, legacyLimit.calls);
    assert.deepEqual(fastifyLimit.calls[1], {
      bucket: "read",
      scopes: ["user:user_1", "workspace:workspace_1"],
    });
    assert.equal(fastifyServices.contexts.length, 1);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify telemetry preserves legacy auth, JSON, and domain validation", async () => {
  const legacyServices = createTelemetryServices();
  const fastifyServices = createTelemetryServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const path = "/api/v1/telemetry/generations?userId=forged&workspaceId=forged";
  const cookie = "better-auth.session_token=signed_session";
  const validBody = JSON.stringify({
    attemptId: "11111111-1111-4111-8111-111111111111",
    category: "image",
    status: "started",
  });

  try {
    const invalidJson = "{";
    const [legacyAnonymous, fastifyAnonymous] = await Promise.all([
      request(legacyPort, path, "POST", jsonHeaders(invalidJson), invalidJson),
      request(fastifyPort, path, "POST", jsonHeaders(invalidJson), invalidJson),
    ]);
    assert.equal(fastifyAnonymous.statusCode, legacyAnonymous.statusCode);
    assert.deepEqual(
      normalizeError(fastifyAnonymous.text),
      normalizeError(legacyAnonymous.text),
    );

    const validHeaders = { ...jsonHeaders(validBody), cookie };
    const [before, after] = await Promise.all([
      request(legacyPort, path, "POST", validHeaders, validBody),
      request(fastifyPort, path, "POST", validHeaders, validBody),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.text, before.text);
    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
    assert.deepEqual(fastifyServices.calls[0]?.actor, {
      userId: "user_1",
      workspaceId: "workspace_1",
    });

    for (const invalidBody of [
      "{",
      '{"status":"started","status":"failed"}',
      Buffer.from([0xc3, 0x28]),
      `${"[".repeat(65)}0${"]".repeat(65)}`,
    ]) {
      const invalidHeaders = { ...jsonHeaders(invalidBody), cookie };
      const [legacyInvalid, fastifyInvalid] = await Promise.all([
        request(legacyPort, path, "POST", invalidHeaders, invalidBody),
        request(fastifyPort, path, "POST", invalidHeaders, invalidBody),
      ]);
      assert.equal(fastifyInvalid.statusCode, legacyInvalid.statusCode);
      assert.deepEqual(
        normalizeError(fastifyInvalid.text),
        normalizeError(legacyInvalid.text),
      );
    }

    const privateBody = JSON.stringify({
      ...JSON.parse(validBody),
      model: "private-model",
    });
    const privateHeaders = { ...jsonHeaders(privateBody), cookie };
    const [legacyPrivate, fastifyPrivate] = await Promise.all([
      request(legacyPort, path, "POST", privateHeaders, privateBody),
      request(fastifyPort, path, "POST", privateHeaders, privateBody),
    ]);
    assert.equal(fastifyPrivate.statusCode, legacyPrivate.statusCode);
    assert.deepEqual(
      normalizeError(fastifyPrivate.text),
      normalizeError(legacyPrivate.text),
    );
    assert.equal(fastifyServices.calls.length, 1);

    const oversizedBody = JSON.stringify({ value: "x".repeat(2 * 1024) });
    const oversizedHeaders = { ...jsonHeaders(oversizedBody), cookie };
    const [legacyOversized, fastifyOversized] = await Promise.all([
      request(legacyPort, path, "POST", oversizedHeaders, oversizedBody),
      request(fastifyPort, path, "POST", oversizedHeaders, oversizedBody),
    ]);
    assert.equal(fastifyOversized.statusCode, legacyOversized.statusCode);
    assert.deepEqual(
      normalizeError(fastifyOversized.text),
      normalizeError(legacyOversized.text),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify telemetry preserves legacy CSRF and fail-closed rate limiting order", async () => {
  function unavailableRateLimiter(): RateLimiter {
    return {
      async consume(bucket) {
        return {
          allowed: false,
          available: false,
          retryAfterSeconds: 1,
          bucket,
        };
      },
      async ping() {},
      async close() {},
    };
  }

  const legacyServices = createTelemetryServices();
  const fastifyServices = createTelemetryServices();
  const legacy = createApiServer({
    config,
    ...legacyServices,
    rateLimiter: unavailableRateLimiter(),
  });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
    rateLimiter: unavailableRateLimiter(),
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const invalidJson = "{";
  const headers = jsonHeaders(invalidJson);

  try {
    const [before, after] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/telemetry/generations",
        "POST",
        headers,
        invalidJson,
      ),
      request(
        fastifyPort,
        "/api/v1/telemetry/generations",
        "POST",
        headers,
        invalidJson,
      ),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.equal(after.headers["retry-after"], before.headers["retry-after"]);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    assert.equal(fastifyServices.contexts.length, 0);
    assert.equal(fastifyServices.calls.length, 0);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }

  const productionConfig = { ...config, env: "production" as const };
  const legacyCsrf = createApiServer({
    config: productionConfig,
    ...createTelemetryServices(),
  });
  const fastifyCsrf = await createFastifyApiServer({
    config: productionConfig,
    ...createTelemetryServices(),
  });
  const legacyCsrfPort = await listen(legacyCsrf);
  const fastifyCsrfPort = await listen(fastifyCsrf);
  const cookieHeaders = {
    ...headers,
    cookie: "better-auth.session_token=signed_session",
  };
  try {
    const [before, after] = await Promise.all([
      request(
        legacyCsrfPort,
        "/api/v1/telemetry/generations",
        "POST",
        cookieHeaders,
        invalidJson,
      ),
      request(
        fastifyCsrfPort,
        "/api/v1/telemetry/generations",
        "POST",
        cookieHeaders,
        invalidJson,
      ),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
  } finally {
    await Promise.all([
      closeApiServer(legacyCsrf, 1_000),
      closeApiServer(fastifyCsrf, 1_000),
    ]);
  }
});

test("Fastify auth lifecycle preserves legacy payloads and cookies", async () => {
  const legacyServices = createAuthLifecycleServices();
  const fastifyServices = createAuthLifecycleServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const cookie = "better-auth.session_token=signed_session";
  const cases: Array<{
    method: string;
    path: string;
    body?: unknown;
    cookie?: string;
  }> = [
    {
      method: "POST",
      path: "/api/v1/auth/register",
      body: {
        username: "Artist_01",
        email: "artist@example.com",
        password: "long-enough-password",
        acceptedTermsAndPrivacy: true,
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { identifier: "Artist_01", password: "long-enough-password" },
    },
    { method: "GET", path: "/api/v1/auth/session", cookie },
    { method: "GET", path: "/api/v1/auth/sessions", cookie },
    { method: "GET", path: "/api/v1/auth/devices", cookie },
    {
      method: "POST",
      path: "/api/v1/auth/registration/email-code",
      body: { email: "artist@example.com" },
    },
    {
      method: "POST",
      path: "/api/v1/auth/password/forgot",
      body: { email: "artist@example.com" },
    },
    {
      method: "POST",
      path: "/api/v1/auth/password/reset",
      body: {
        email: "artist@example.com",
        code: "123456",
        password: "new-long-enough-password",
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/password/change",
      cookie,
      body: {
        currentPassword: "long-enough-password",
        newPassword: "new-long-enough-password",
      },
    },
    {
      method: "DELETE",
      path: "/api/v1/auth/sessions/session_other",
      cookie,
    },
    {
      method: "DELETE",
      path: "/api/v1/auth/devices/11111111-1111-4111-8111-111111111111",
      cookie,
    },
    { method: "POST", path: "/api/v1/auth/logout", cookie },
    { method: "POST", path: "/api/v1/auth/logout" },
  ];

  try {
    for (const entry of cases) {
      const body =
        entry.body === undefined ? undefined : JSON.stringify(entry.body);
      const headers = {
        ...(body ? jsonHeaders(body) : {}),
        ...(entry.cookie ? { cookie: entry.cookie } : {}),
        "user-agent": "auth-contract-test",
      };
      const [before, after] = await Promise.all([
        request(legacyPort, entry.path, entry.method, headers, body),
        request(fastifyPort, entry.path, entry.method, headers, body),
      ]);
      assert.equal(after.statusCode, before.statusCode, entry.path);
      assert.equal(after.text, before.text, entry.path);
      assert.deepEqual(
        after.headers["set-cookie"],
        before.headers["set-cookie"],
        entry.path,
      );
    }
    assert.deepEqual(
      fastifyServices.calls.map(({ method, input }) => ({ method, input })),
      legacyServices.calls.map(({ method, input }) => ({ method, input })),
    );
    assert(
      fastifyServices.calls.every(
        ({ context }) =>
          context.userAgent === "auth-contract-test" &&
          Boolean(context.requestId),
      ),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify auth preserves legacy protected-body order and domain errors", async () => {
  const legacyServices = createAuthLifecycleServices();
  const fastifyServices = createAuthLifecycleServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({
    config,
    ...fastifyServices,
  });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);

  try {
    const invalidBody = "{";
    const invalidHeaders = jsonHeaders(invalidBody);
    const [legacyAnonymous, fastifyAnonymous] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/auth/password/change",
        "POST",
        invalidHeaders,
        invalidBody,
      ),
      request(
        fastifyPort,
        "/api/v1/auth/password/change",
        "POST",
        invalidHeaders,
        invalidBody,
      ),
    ]);
    assert.equal(fastifyAnonymous.statusCode, legacyAnonymous.statusCode);
    assert.deepEqual(
      normalizeError(fastifyAnonymous.text),
      normalizeError(legacyAnonymous.text),
    );

    const conflictBody = JSON.stringify({
      identifier: "conflict",
      password: "long-enough-password",
    });
    const conflictHeaders = jsonHeaders(conflictBody);
    const [before, after] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/auth/login",
        "POST",
        conflictHeaders,
        conflictBody,
      ),
      request(
        fastifyPort,
        "/api/v1/auth/login",
        "POST",
        conflictHeaders,
        conflictBody,
      ),
    ]);
    assert.equal(after.statusCode, before.statusCode);
    assert.deepEqual(normalizeError(after.text), normalizeError(before.text));

    const oversizedBody = JSON.stringify({
      identifier: "x".repeat(64 * 1024),
      password: "long-enough-password",
    });
    const oversizedHeaders = jsonHeaders(oversizedBody);
    const [legacyOversized, fastifyOversized] = await Promise.all([
      request(
        legacyPort,
        "/api/v1/auth/login",
        "POST",
        oversizedHeaders,
        oversizedBody,
      ),
      request(
        fastifyPort,
        "/api/v1/auth/login",
        "POST",
        oversizedHeaders,
        oversizedBody,
      ),
    ]);
    assert.equal(fastifyOversized.statusCode, legacyOversized.statusCode);
    assert.deepEqual(
      normalizeError(fastifyOversized.text),
      normalizeError(legacyOversized.text),
    );

    for (const path of [
      "/api/v1/auth/logout",
      "/api/v1/auth/sessions/session_other",
      "/api/v1/auth/devices/11111111-1111-4111-8111-111111111111",
    ]) {
      const method = path.endsWith("logout") ? "POST" : "DELETE";
      const ignoredHeaders = {
        ...jsonHeaders(invalidBody),
        cookie: "better-auth.session_token=signed_session",
      };
      const [legacyIgnored, fastifyIgnored] = await Promise.all([
        request(legacyPort, path, method, ignoredHeaders, invalidBody),
        request(fastifyPort, path, method, ignoredHeaders, invalidBody),
      ]);
      assert.equal(fastifyIgnored.statusCode, legacyIgnored.statusCode, path);
      assert.equal(fastifyIgnored.text, legacyIgnored.text, path);
      assert.deepEqual(
        fastifyIgnored.headers["set-cookie"],
        legacyIgnored.headers["set-cookie"],
        path,
      );
    }
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify internal asset cleanup preserves legacy access and failure boundaries", async () => {
  const legacyServices = createAssetCleanupServices();
  const fastifyServices = createAssetCleanupServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({ config, ...fastifyServices });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const tokenHeaders = {
    authorization: `Bearer ${config.assetMaintenanceToken}`,
  };

  try {
    const cases = [
      { headers: {}, body: "{" },
      {
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({ apply: false }),
      },
      { headers: tokenHeaders, body: JSON.stringify({ apply: false }) },
      {
        headers: tokenHeaders,
        body: JSON.stringify({ apply: false, objectKey: "private/key" }),
      },
      { headers: tokenHeaders, body: JSON.stringify({ apply: true }) },
      {
        headers: tokenHeaders,
        body: JSON.stringify({ apply: false, padding: "x".repeat(1_024) }),
      },
    ];
    for (const testCase of cases) {
      const headers = { ...jsonHeaders(testCase.body), ...testCase.headers };
      const [before, after] = await Promise.all([
        request(
          legacyPort,
          "/internal/v1/asset-cleanup",
          "POST",
          headers,
          testCase.body,
        ),
        request(
          fastifyPort,
          "/internal/v1/asset-cleanup",
          "POST",
          headers,
          testCase.body,
        ),
      ]);
      assert.equal(after.statusCode, before.statusCode);
      if (after.statusCode >= 400) {
        assert.deepEqual(
          normalizeError(after.text),
          normalizeError(before.text),
        );
      } else {
        assert.equal(after.text, before.text);
      }
    }
    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify asset routes preserve legacy actors, bodies, and domain errors", async () => {
  const legacyServices = createAssetServices();
  const fastifyServices = createAssetServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({ config, ...fastifyServices });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const cookie = "better-auth.session_token=signed_session";

  async function compare(
    path: string,
    method = "GET",
    body?: string,
    authenticated = true,
  ) {
    const headers = {
      ...(body === undefined ? {} : jsonHeaders(body)),
      ...(authenticated ? { cookie } : {}),
    };
    const [before, after] = await Promise.all([
      request(legacyPort, path, method, headers, body),
      request(fastifyPort, path, method, headers, body),
    ]);
    assert.equal(after.statusCode, before.statusCode, path);
    if (after.statusCode >= 400) {
      assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    } else {
      assert.equal(after.text, before.text);
    }
  }

  try {
    await compare("/api/v1/assets/uploads", "POST", "{", false);
    await compare("/api/v1/assets/uploads", "POST", "{");

    const createBody = JSON.stringify({
      projectId: "11111111-1111-4111-8111-111111111111",
      originalFileName: "reference.png",
      mimeType: "image/png",
      byteSize: 2048,
      assetKind: "upload",
      idempotencyKey: "asset_upload_1",
      userId: "forged-user",
      workspaceId: "forged-workspace",
    });
    await compare("/api/v1/assets/uploads", "POST", createBody);

    const quotaBody = JSON.stringify({
      originalFileName: "quota.png",
      mimeType: "image/png",
      byteSize: 1,
      assetKind: "upload",
      idempotencyKey: "quota-error",
    });
    await compare("/api/v1/assets/uploads", "POST", quotaBody);

    const oversizedBody = JSON.stringify({
      originalFileName: "x".repeat(64 * 1024),
      mimeType: "image/png",
      byteSize: 1,
      assetKind: "upload",
      idempotencyKey: "oversized",
    });
    await compare("/api/v1/assets/uploads", "POST", oversizedBody);

    await compare(
      `/api/v1/assets/uploads/${legacyServices.uploadId}/complete?workspaceId=forged`,
      "POST",
      "{",
    );
    await compare(
      `/api/v1/assets/${legacyServices.assetId}?workspaceId=forged`,
    );
    await compare(`/api/v1/assets/${legacyServices.assetId}/url?userId=forged`);
    await compare("/api/v1/assets/uploads/url");
    await compare("/api/v1/assets/uploads", "GET", undefined, false);

    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
    assert(
      fastifyServices.calls.every(
        ({ actor }) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify migration routes preserve legacy bodies, actors, and export errors", async () => {
  const legacyServices = createMigrationServices();
  const fastifyServices = createMigrationServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({ config, ...fastifyServices });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const cookie = "better-auth.session_token=signed_session";

  async function compare(
    path: string,
    method = "GET",
    body?: string,
    authenticated = true,
  ) {
    const headers = {
      ...(body === undefined ? {} : jsonHeaders(body)),
      ...(authenticated ? { cookie } : {}),
    };
    const [before, after] = await Promise.all([
      request(legacyPort, path, method, headers, body),
      request(fastifyPort, path, method, headers, body),
    ]);
    assert.equal(after.statusCode, before.statusCode, path);
    if (after.statusCode >= 400) {
      assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    } else {
      assert.equal(after.text, before.text, path);
    }
  }

  const importPath = `/api/v1/migrations/imports/${legacyServices.importId}`;
  const assetPath = `${importPath}/assets/${legacyServices.logicalAssetId}`;
  const exportPath = `/api/v1/projects/${legacyServices.projectId}/exports`;

  try {
    await compare("/api/v1/migrations/imports/prepare", "POST", "{", false);
    await compare(
      "/api/v1/migrations/imports/prepare",
      "POST",
      JSON.stringify({ idempotencyKey: "prepare-1" }),
    );
    await compare(`${importPath}?workspaceId=forged`);
    await compare(
      `${importPath}/commit`,
      "POST",
      JSON.stringify({ idempotencyKey: "commit-1", strategy: "copy" }),
    );
    await compare(
      `${importPath}/cancel`,
      "POST",
      JSON.stringify({ forged: true }),
    );
    await compare(`${importPath}/cancel`, "POST", JSON.stringify({}));

    await compare(`${assetPath}/upload`, "POST", JSON.stringify({}));
    await compare(`${assetPath}/upload`);
    await compare(
      `${assetPath}/parts/1/complete`,
      "POST",
      JSON.stringify({ etag: "etag-1", byteSize: 8 }),
    );
    await compare(`${assetPath}/complete`, "POST");
    await compare(
      `${assetPath}/complete`,
      "POST",
      JSON.stringify({ parts: {} }),
    );
    await compare(`${assetPath}/cancel`, "POST", JSON.stringify({}));

    await compare(
      `${exportPath}/prepare`,
      "POST",
      JSON.stringify({
        idempotencyKey: "export-1",
        expectedVersion: 2,
        expectedSequence: 3,
      }),
    );
    await compare(`${exportPath}/${legacyServices.exportId}`);
    await compare(`${exportPath}/${legacyServices.exportId}/download`);
    await compare(
      `${exportPath}/${legacyServices.exportId}/cancel`,
      "POST",
      JSON.stringify({}),
    );
    await compare(
      `${exportPath}/${legacyServices.exportId}/retry`,
      "POST",
      JSON.stringify({}),
    );
    await compare(`${exportPath}/explode`);
    await compare(
      `${exportPath}/${legacyServices.exportId}/retry`,
      "GET",
      undefined,
      false,
    );

    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
    assert(
      fastifyServices.calls.every(
        ({ actor }) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("Fastify project routes preserve legacy queries, actors, limits, and domain errors", async () => {
  const legacyServices = createProjectServices();
  const fastifyServices = createProjectServices();
  const legacy = createApiServer({ config, ...legacyServices });
  const fastify = await createFastifyApiServer({ config, ...fastifyServices });
  const legacyPort = await listen(legacy);
  const fastifyPort = await listen(fastify);
  const cookie = "better-auth.session_token=signed_session";

  async function compare(
    path: string,
    method = "GET",
    body?: string,
    authenticated = true,
  ) {
    const headers = {
      ...(body === undefined ? {} : jsonHeaders(body)),
      ...(authenticated ? { cookie } : {}),
    };
    const [before, after] = await Promise.all([
      request(legacyPort, path, method, headers, body),
      request(fastifyPort, path, method, headers, body),
    ]);
    assert.equal(after.statusCode, before.statusCode, `${method} ${path}`);
    if (after.statusCode >= 400) {
      assert.deepEqual(normalizeError(after.text), normalizeError(before.text));
    } else {
      assert.deepEqual(JSON.parse(after.text), JSON.parse(before.text));
    }
  }

  const projectPath = `/api/v1/projects/${legacyServices.projectId}`;
  const graphBody = (baseVersion: number, padding = "") =>
    JSON.stringify({
      baseVersion,
      clientId: "client-1",
      batchId: `batch-${baseVersion}`,
      idempotencyKey: `idempotency-${baseVersion}`,
      operations: [
        {
          type: "upsertNode",
          node: {
            id: "node-1",
            nodeType: "text",
            position: { x: 0, y: 0 },
            dataSchemaVersion: 1,
            data: { padding },
          },
        },
      ],
    });

  try {
    await compare("/api/v1/projects", "POST", "{", false);
    await compare(
      "/api/v1/projects?status=archived&cursor=cursor-1&limit=10&limit=20&userId=forged",
    );
    await compare(
      "/api/v1/projects",
      "POST",
      JSON.stringify({ id: legacyServices.projectId, name: "Created" }),
    );
    await compare(`${projectPath}?workspaceId=forged`);
    await compare(projectPath, "PATCH", JSON.stringify({ name: "Renamed" }));
    await compare(`${projectPath}/archive`, "POST");
    await compare(`${projectPath}/restore`, "POST");
    await compare(projectPath, "DELETE");
    await compare(`${projectPath}/graph`);
    await compare(
      `${projectPath}/graph`,
      "PATCH",
      graphBody(2, "x".repeat(1_100_000)),
    );
    await compare(`${projectPath}/changes?after=7&after=9&workspaceId=forged`);
    await compare(
      `${projectPath}/checkpoints`,
      "POST",
      JSON.stringify({
        expectedVersion: 2,
        expectedSequence: 3,
        checkpointType: "manual",
      }),
    );
    await compare(`${projectPath}/revisions?cursor=cursor-2&limit=1&limit=2`);
    await compare(`${projectPath}/revisions/2`);
    await compare(
      `${projectPath}/revisions/2/restore`,
      "POST",
      JSON.stringify({ expectedVersion: 2, expectedSequence: 3 }),
    );
    await compare(`${projectPath}/graph`, "PATCH", graphBody(99));
    await compare(
      `${projectPath}/graph`,
      "PATCH",
      graphBody(2, "x".repeat(2 * 1024 * 1024)),
    );
    await compare(`${projectPath}/graph`, "POST", undefined, false);

    assert.deepEqual(fastifyServices.calls, legacyServices.calls);
    assert(
      fastifyServices.calls.every(
        ({ actor }) =>
          actor.userId === "user_1" && actor.workspaceId === "workspace_1",
      ),
    );
  } finally {
    await Promise.all([
      closeApiServer(legacy, 1_000),
      closeApiServer(fastify, 1_000),
    ]);
  }
});

test("OpenAPI is available only in development Fastify mode", async () => {
  const development = await createFastifyApiServer({
    config: { ...config, env: "development", httpAdapter: "fastify" },
  });
  const production = await createFastifyApiServer({
    config: { ...config, env: "production", httpAdapter: "fastify" },
  });
  const developmentPort = await listen(development);
  const productionPort = await listen(production);

  try {
    const specification = await request(developmentPort, "/docs/json");
    assert.equal(specification.statusCode, 200);
    const openapi = JSON.parse(specification.text) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const operationIds = Object.values(openapi.paths).flatMap((path) =>
      Object.values(path)
        .map((operation) => operation.operationId)
        .filter((value): value is string => Boolean(value)),
    );
    assert.equal(operationIds.length, 54);
    assert.equal(new Set(operationIds).size, operationIds.length);
    assert.equal((await request(productionPort, "/docs")).statusCode, 404);
    assert.equal((await request(productionPort, "/docs/json")).statusCode, 404);
  } finally {
    await Promise.all([
      closeApiServer(development, 1_000),
      closeApiServer(production, 1_000),
    ]);
  }
});

test("Fastify serves the static SPA without intercepting API 404 responses", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai-canvas-fastify-static-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<main>fastify canvas</main>");
  writeFileSync(join(root, "assets", "app.12345678.js"), "export {};");
  const server = await createFastifyApiServer({
    config: { ...config, staticSiteRoot: root },
  });
  const port = await listen(server);

  try {
    const asset = await request(port, "/assets/app.12345678.js");
    assert.equal(asset.statusCode, 200);
    assert.equal(
      asset.headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    assert.equal(asset.text, "export {};");

    const applicationRoute = await request(port, "/projects/project-1");
    assert.equal(applicationRoute.statusCode, 200);
    assert.equal(applicationRoute.headers["cache-control"], "no-store");
    assert.equal(applicationRoute.text, "<main>fastify canvas</main>");

    const missingAsset = await request(port, "/assets/missing.js");
    assert.equal(missingAsset.statusCode, 404);
    assert.equal(
      missingAsset.headers["content-type"],
      "text/plain; charset=utf-8",
    );

    const missingApi = await request(port, "/api/v1/not-real");
    assert.equal(missingApi.statusCode, 404);
    assert.match(missingApi.headers["content-type"] ?? "", /application\/json/);
    assert.equal(
      (JSON.parse(missingApi.text) as { error: { code: string } }).error.code,
      "SERVICE_UNAVAILABLE",
    );
  } finally {
    await closeApiServer(server, 1_000);
    rmSync(root, { recursive: true, force: true });
  }
});
