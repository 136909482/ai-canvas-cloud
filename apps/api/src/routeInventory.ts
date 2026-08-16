export type PublicRouteGroup =
  | "system"
  | "auth"
  | "workspaces"
  | "telemetry"
  | "task-records"
  | "assets"
  | "migrations"
  | "projects"
  | "settings"
  | "community"
  | "announcements";

export interface PublicRouteInventoryEntry {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  operationId: string;
  group: PublicRouteGroup;
}

export const PUBLIC_ROUTE_INVENTORY = [
  {
    method: "GET",
    path: "/metrics",
    operationId: "getPrometheusMetrics",
    group: "system",
  },
  {
    method: "GET",
    path: "/health/live",
    operationId: "getSystemHealthLive",
    group: "system",
  },
  {
    method: "GET",
    path: "/health/ready",
    operationId: "getSystemHealthReady",
    group: "system",
  },
  {
    method: "GET",
    path: "/api/v1/health/live",
    operationId: "getApiHealthLive",
    group: "system",
  },
  {
    method: "GET",
    path: "/api/v1/health/ready",
    operationId: "getApiHealthReady",
    group: "system",
  },
  {
    method: "GET",
    path: "/api/v1/site-config",
    operationId: "getPublicSiteConfig",
    group: "system",
  },

  {
    method: "POST",
    path: "/api/v1/auth/register",
    operationId: "registerUser",
    group: "auth",
  },
  {
    method: "POST",
    path: "/api/v1/auth/login",
    operationId: "loginUser",
    group: "auth",
  },
  {
    method: "POST",
    path: "/api/v1/auth/logout",
    operationId: "logoutUser",
    group: "auth",
  },
  {
    method: "GET",
    path: "/api/v1/auth/session",
    operationId: "getAuthSession",
    group: "auth",
  },
  {
    method: "GET",
    path: "/api/v1/auth/sessions",
    operationId: "listAuthSessions",
    group: "auth",
  },
  {
    method: "DELETE",
    path: "/api/v1/auth/sessions/:sessionId",
    operationId: "deleteAuthSession",
    group: "auth",
  },
  {
    method: "GET",
    path: "/api/v1/auth/devices",
    operationId: "listAuthDevices",
    group: "auth",
  },
  {
    method: "DELETE",
    path: "/api/v1/auth/devices/:deviceId",
    operationId: "deleteAuthDevice",
    group: "auth",
  },
  {
    method: "POST",
    path: "/api/v1/auth/registration/email-code",
    operationId: "requestRegistrationEmailCode",
    group: "auth",
  },
  {
    method: "POST",
    path: "/api/v1/auth/password/forgot",
    operationId: "requestPasswordResetEmailCode",
    group: "auth",
  },
  {
    method: "POST",
    path: "/api/v1/auth/password/reset",
    operationId: "resetPassword",
    group: "auth",
  },
  {
    method: "POST",
    path: "/api/v1/auth/password/change",
    operationId: "changePassword",
    group: "auth",
  },

  {
    method: "GET",
    path: "/api/v1/workspaces/current",
    operationId: "getCurrentWorkspace",
    group: "workspaces",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/current/usage",
    operationId: "getCurrentWorkspaceUsage",
    group: "workspaces",
  },
  {
    method: "GET",
    path: "/api/v1/settings",
    operationId: "getCanvasPreferences",
    group: "settings",
  },
  {
    method: "PATCH",
    path: "/api/v1/settings",
    operationId: "updateCanvasPreferences",
    group: "settings",
  },
  {
    method: "GET",
    path: "/api/v1/community/posts",
    operationId: "listCommunityPosts",
    group: "community",
  },
  {
    method: "GET",
    path: "/api/v1/community/posts/:postId",
    operationId: "getCommunityPost",
    group: "community",
  },
  {
    method: "GET",
    path: "/api/v1/community/profile",
    operationId: "getCommunityProfile",
    group: "community",
  },
  {
    method: "PATCH",
    path: "/api/v1/community/profile",
    operationId: "updateCommunityProfile",
    group: "community",
  },
  {
    method: "GET",
    path: "/api/v1/community/me/posts",
    operationId: "listMyCommunityPosts",
    group: "community",
  },
  {
    method: "POST",
    path: "/api/v1/community/posts",
    operationId: "createCommunityPost",
    group: "community",
  },
  {
    method: "PATCH",
    path: "/api/v1/community/posts/:postId",
    operationId: "updateCommunityPost",
    group: "community",
  },
  {
    method: "POST",
    path: "/api/v1/community/posts/:postId/withdraw",
    operationId: "withdrawCommunityPost",
    group: "community",
  },
  {
    method: "POST",
    path: "/api/v1/community/posts/:postId/report",
    operationId: "reportCommunityPost",
    group: "community",
  },
  {
    method: "POST",
    path: "/api/v1/telemetry/generations",
    operationId: "createGenerationTelemetry",
    group: "telemetry",
  },
  {
    method: "POST",
    path: "/api/v1/task-records",
    operationId: "createGenerationTaskRecord",
    group: "task-records",
  },
  {
    method: "GET",
    path: "/api/v1/task-records",
    operationId: "listGenerationTaskRecords",
    group: "task-records",
  },
  {
    method: "GET",
    path: "/api/v1/announcements",
    operationId: "listAnnouncements",
    group: "announcements",
  },
  {
    method: "POST",
    path: "/api/v1/announcements/read",
    operationId: "markAnnouncementsRead",
    group: "announcements",
  },

  {
    method: "POST",
    path: "/internal/v1/asset-cleanup",
    operationId: "runInternalAssetCleanup",
    group: "assets",
  },
  {
    method: "POST",
    path: "/api/v1/assets/uploads",
    operationId: "createAssetUpload",
    group: "assets",
  },
  {
    method: "POST",
    path: "/api/v1/assets/uploads/:uploadId/complete",
    operationId: "completeAssetUpload",
    group: "assets",
  },
  {
    method: "GET",
    path: "/api/v1/assets/:assetId",
    operationId: "getAsset",
    group: "assets",
  },
  {
    method: "GET",
    path: "/api/v1/assets/:assetId/url",
    operationId: "getAssetUrl",
    group: "assets",
  },

  {
    method: "POST",
    path: "/api/v1/migrations/imports/prepare",
    operationId: "prepareMigrationImport",
    group: "migrations",
  },
  {
    method: "GET",
    path: "/api/v1/migrations/imports/:importId",
    operationId: "getMigrationImport",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/cancel",
    operationId: "cancelMigrationImport",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/commit",
    operationId: "commitMigrationImport",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload",
    operationId: "createMigrationAssetUpload",
    group: "migrations",
  },
  {
    method: "GET",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload",
    operationId: "getMigrationAssetUpload",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/parts/:partNumber/complete",
    operationId: "completeMigrationAssetUploadPart",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/complete",
    operationId: "completeMigrationAssetUpload",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/cancel",
    operationId: "cancelMigrationAssetUpload",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/exports/prepare",
    operationId: "prepareMigrationExport",
    group: "migrations",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/exports/:exportId",
    operationId: "getMigrationExport",
    group: "migrations",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/exports/:exportId/download",
    operationId: "downloadMigrationExport",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/exports/:exportId/cancel",
    operationId: "cancelMigrationExport",
    group: "migrations",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/exports/:exportId/retry",
    operationId: "retryMigrationExport",
    group: "migrations",
  },

  {
    method: "GET",
    path: "/api/v1/projects",
    operationId: "listProjects",
    group: "projects",
  },
  {
    method: "POST",
    path: "/api/v1/projects",
    operationId: "createProject",
    group: "projects",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId",
    operationId: "getProject",
    group: "projects",
  },
  {
    method: "PATCH",
    path: "/api/v1/projects/:projectId",
    operationId: "updateProject",
    group: "projects",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/archive",
    operationId: "archiveProject",
    group: "projects",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/restore",
    operationId: "restoreProject",
    group: "projects",
  },
  {
    method: "DELETE",
    path: "/api/v1/projects/:projectId",
    operationId: "deleteProject",
    group: "projects",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/graph",
    operationId: "getProjectGraph",
    group: "projects",
  },
  {
    method: "PATCH",
    path: "/api/v1/projects/:projectId/graph",
    operationId: "applyProjectGraphOperations",
    group: "projects",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/changes",
    operationId: "getProjectChanges",
    group: "projects",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/checkpoints",
    operationId: "createProjectCheckpoint",
    group: "projects",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/revisions",
    operationId: "listProjectRevisions",
    group: "projects",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/revisions/:version",
    operationId: "getProjectRevision",
    group: "projects",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/revisions/:version/restore",
    operationId: "restoreProjectRevision",
    group: "projects",
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
