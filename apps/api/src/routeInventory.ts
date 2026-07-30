export type PublicRouteGroup =
  | "system"
  | "auth"
  | "workspaces"
  | "telemetry"
  | "assets"
  | "migrations"
  | "projects";

export interface PublicRouteInventoryEntry {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  operationId: string;
  group: PublicRouteGroup;
  owner: "legacy" | "fastify";
}

export const PUBLIC_ROUTE_INVENTORY = [
  {
    method: "GET",
    path: "/metrics",
    operationId: "getPrometheusMetrics",
    group: "system",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/health/live",
    operationId: "getSystemHealthLive",
    group: "system",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/health/ready",
    operationId: "getSystemHealthReady",
    group: "system",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/api/v1/health/live",
    operationId: "getApiHealthLive",
    group: "system",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/api/v1/health/ready",
    operationId: "getApiHealthReady",
    group: "system",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/api/v1/site-config",
    operationId: "getPublicSiteConfig",
    group: "system",
    owner: "fastify",
  },

  {
    method: "POST",
    path: "/api/v1/auth/register",
    operationId: "registerUser",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "POST",
    path: "/api/v1/auth/login",
    operationId: "loginUser",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "POST",
    path: "/api/v1/auth/logout",
    operationId: "logoutUser",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/api/v1/auth/session",
    operationId: "getAuthSession",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/api/v1/auth/sessions",
    operationId: "listAuthSessions",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "DELETE",
    path: "/api/v1/auth/sessions/:sessionId",
    operationId: "deleteAuthSession",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/api/v1/auth/devices",
    operationId: "listAuthDevices",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "DELETE",
    path: "/api/v1/auth/devices/:deviceId",
    operationId: "deleteAuthDevice",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "POST",
    path: "/api/v1/auth/registration/email-code",
    operationId: "requestRegistrationEmailCode",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "POST",
    path: "/api/v1/auth/password/forgot",
    operationId: "requestPasswordResetEmailCode",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "POST",
    path: "/api/v1/auth/password/reset",
    operationId: "resetPassword",
    group: "auth",
    owner: "fastify",
  },
  {
    method: "POST",
    path: "/api/v1/auth/password/change",
    operationId: "changePassword",
    group: "auth",
    owner: "fastify",
  },

  {
    method: "GET",
    path: "/api/v1/workspaces/current",
    operationId: "getCurrentWorkspace",
    group: "workspaces",
    owner: "fastify",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/current/usage",
    operationId: "getCurrentWorkspaceUsage",
    group: "workspaces",
    owner: "fastify",
  },
  {
    method: "POST",
    path: "/api/v1/telemetry/generations",
    operationId: "createGenerationTelemetry",
    group: "telemetry",
    owner: "fastify",
  },

  {
    method: "POST",
    path: "/internal/v1/asset-cleanup",
    operationId: "runInternalAssetCleanup",
    group: "assets",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/assets/uploads",
    operationId: "createAssetUpload",
    group: "assets",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/assets/uploads/:uploadId/complete",
    operationId: "completeAssetUpload",
    group: "assets",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/assets/:assetId",
    operationId: "getAsset",
    group: "assets",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/assets/:assetId/url",
    operationId: "getAssetUrl",
    group: "assets",
    owner: "legacy",
  },

  {
    method: "POST",
    path: "/api/v1/migrations/imports/prepare",
    operationId: "prepareMigrationImport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/migrations/imports/:importId",
    operationId: "getMigrationImport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/cancel",
    operationId: "cancelMigrationImport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/commit",
    operationId: "commitMigrationImport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload",
    operationId: "createMigrationAssetUpload",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload",
    operationId: "getMigrationAssetUpload",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/parts/:partNumber/complete",
    operationId: "completeMigrationAssetUploadPart",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/complete",
    operationId: "completeMigrationAssetUpload",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/cancel",
    operationId: "cancelMigrationAssetUpload",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/exports/prepare",
    operationId: "prepareMigrationExport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/exports/:exportId",
    operationId: "getMigrationExport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/exports/:exportId/download",
    operationId: "downloadMigrationExport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/exports/:exportId/cancel",
    operationId: "cancelMigrationExport",
    group: "migrations",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/exports/:exportId/retry",
    operationId: "retryMigrationExport",
    group: "migrations",
    owner: "legacy",
  },

  {
    method: "GET",
    path: "/api/v1/projects",
    operationId: "listProjects",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects",
    operationId: "createProject",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId",
    operationId: "getProject",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "PATCH",
    path: "/api/v1/projects/:projectId",
    operationId: "updateProject",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/archive",
    operationId: "archiveProject",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/restore",
    operationId: "restoreProject",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "DELETE",
    path: "/api/v1/projects/:projectId",
    operationId: "deleteProject",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/graph",
    operationId: "getProjectGraph",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "PATCH",
    path: "/api/v1/projects/:projectId/graph",
    operationId: "applyProjectGraphOperations",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/changes",
    operationId: "getProjectChanges",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/checkpoints",
    operationId: "createProjectCheckpoint",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/revisions",
    operationId: "listProjectRevisions",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/revisions/:version",
    operationId: "getProjectRevision",
    group: "projects",
    owner: "legacy",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/revisions/:version/restore",
    operationId: "restoreProjectRevision",
    group: "projects",
    owner: "legacy",
  },
] as const satisfies readonly PublicRouteInventoryEntry[];

export function publicRouteKey(
  route: Pick<PublicRouteInventoryEntry, "method" | "path">,
) {
  return `${route.method} ${route.path}`;
}

export function openApiPath(path: string) {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
}
