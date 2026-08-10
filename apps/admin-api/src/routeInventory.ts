export type AdminRouteGroup =
  | "system"
  | "auth-security"
  | "dashboard-audit"
  | "users"
  | "site"
  | "smtp"
  | "object-storage"
  | "announcements"
  | "community";

export interface AdminRouteInventoryEntry {
  method: "GET" | "POST";
  path: string;
  operationId: string;
  group: AdminRouteGroup;
}

export const ADMIN_ROUTE_INVENTORY = [
  {
    method: "POST",
    path: "/admin/v1/community/users/:userId/hide",
    operationId: "hideCommunityUser",
    group: "community",
  },
  {
    method: "POST",
    path: "/admin/v1/community/users/:userId/unhide",
    operationId: "unhideCommunityUser",
    group: "community",
  },
  {
    method: "GET",
    path: "/metrics",
    operationId: "getAdminPrometheusMetrics",
    group: "system",
  },
  {
    method: "GET",
    path: "/health/live",
    operationId: "getAdminHealthLive",
    group: "system",
  },
  {
    method: "GET",
    path: "/admin/v1/system-update",
    operationId: "getAdminSystemUpdate",
    group: "system",
  },
  {
    method: "POST",
    path: "/admin/v1/system-update",
    operationId: "requestAdminSystemUpdate",
    group: "system",
  },
  {
    method: "GET",
    path: "/health/ready",
    operationId: "getAdminHealthReady",
    group: "system",
  },
  {
    method: "GET",
    path: "/admin/v1/auth/csrf",
    operationId: "getAdminCsrfToken",
    group: "auth-security",
  },
  {
    method: "GET",
    path: "/admin/v1/auth/captcha",
    operationId: "getAdminLoginCaptcha",
    group: "auth-security",
  },
  {
    method: "POST",
    path: "/admin/v1/auth/login",
    operationId: "loginAdministrator",
    group: "auth-security",
  },
  {
    method: "GET",
    path: "/admin/v1/auth/session",
    operationId: "getAdministratorSession",
    group: "auth-security",
  },
  {
    method: "POST",
    path: "/admin/v1/auth/username",
    operationId: "updateAdministratorUsername",
    group: "auth-security",
  },
  {
    method: "POST",
    path: "/admin/v1/auth/password",
    operationId: "changeAdministratorPassword",
    group: "auth-security",
  },
  {
    method: "GET",
    path: "/admin/v1/auth/login-security",
    operationId: "getAdminLoginSecurity",
    group: "auth-security",
  },
  {
    method: "POST",
    path: "/admin/v1/auth/login-security",
    operationId: "updateAdminLoginSecurity",
    group: "auth-security",
  },
  {
    method: "POST",
    path: "/admin/v1/auth/logout",
    operationId: "logoutAdministrator",
    group: "auth-security",
  },
  {
    method: "GET",
    path: "/admin/v1/audit-events",
    operationId: "listAdminAuditEvents",
    group: "dashboard-audit",
  },
  {
    method: "GET",
    path: "/admin/v1/dashboard",
    operationId: "getAdminDashboard",
    group: "dashboard-audit",
  },
  {
    method: "GET",
    path: "/admin/v1/announcements",
    operationId: "listAdminAnnouncements",
    group: "announcements",
  },
  {
    method: "POST",
    path: "/admin/v1/announcements",
    operationId: "createAdminAnnouncementDraft",
    group: "announcements",
  },
  {
    method: "POST",
    path: "/admin/v1/announcements/:announcementId",
    operationId: "updateAdminAnnouncementDraft",
    group: "announcements",
  },
  {
    method: "POST",
    path: "/admin/v1/announcements/:announcementId/publish",
    operationId: "publishAdminAnnouncement",
    group: "announcements",
  },
  {
    method: "POST",
    path: "/admin/v1/announcements/:announcementId/archive",
    operationId: "archiveAdminAnnouncement",
    group: "announcements",
  },
  {
    method: "GET",
    path: "/admin/v1/community/posts",
    operationId: "listAdminCommunityPosts",
    group: "community",
  },
  {
    method: "POST",
    path: "/admin/v1/community/posts/:postId/approve",
    operationId: "approveCommunityPost",
    group: "community",
  },
  {
    method: "POST",
    path: "/admin/v1/community/posts/:postId/reject",
    operationId: "rejectCommunityPost",
    group: "community",
  },
  {
    method: "POST",
    path: "/admin/v1/community/posts/:postId/remove",
    operationId: "removeCommunityPost",
    group: "community",
  },
  {
    method: "GET",
    path: "/admin/v1/community/reports",
    operationId: "listAdminCommunityReports",
    group: "community",
  },
  {
    method: "POST",
    path: "/admin/v1/community/reports/:reportId/resolve",
    operationId: "resolveCommunityReport",
    group: "community",
  },
  {
    method: "GET",
    path: "/admin/v1/users",
    operationId: "listAdminUsers",
    group: "users",
  },
  {
    method: "GET",
    path: "/admin/v1/users/:userId",
    operationId: "getAdminUser",
    group: "users",
  },
  {
    method: "GET",
    path: "/admin/v1/users/:userId/deletion-preview",
    operationId: "getAdminUserDeletionPreview",
    group: "users",
  },
  {
    method: "POST",
    path: "/admin/v1/users/:userId/delete",
    operationId: "deleteAdminUser",
    group: "users",
  },
  {
    method: "POST",
    path: "/admin/v1/users/:userId/ban",
    operationId: "banAdminUser",
    group: "users",
  },
  {
    method: "POST",
    path: "/admin/v1/users/:userId/unban",
    operationId: "unbanAdminUser",
    group: "users",
  },
  {
    method: "POST",
    path: "/admin/v1/users/:userId/revoke-sessions",
    operationId: "revokeAdminUserSessions",
    group: "users",
  },
  {
    method: "POST",
    path: "/admin/v1/users/:userId/reset-password",
    operationId: "resetAdminUserPassword",
    group: "users",
  },
  {
    method: "GET",
    path: "/admin/v1/site-config",
    operationId: "getAdminSiteConfig",
    group: "site",
  },
  {
    method: "POST",
    path: "/admin/v1/site-config",
    operationId: "publishAdminSiteConfig",
    group: "site",
  },
  {
    method: "GET",
    path: "/admin/v1/site-assets",
    operationId: "listAdminSiteAssets",
    group: "site",
  },
  {
    method: "POST",
    path: "/admin/v1/site-assets",
    operationId: "createAdminSiteAsset",
    group: "site",
  },
  {
    method: "POST",
    path: "/admin/v1/site-assets/:assetId/complete",
    operationId: "completeAdminSiteAsset",
    group: "site",
  },
  {
    method: "GET",
    path: "/admin/v1/smtp-settings",
    operationId: "getAdminSmtpSettings",
    group: "smtp",
  },
  {
    method: "POST",
    path: "/admin/v1/smtp-settings/test-connection",
    operationId: "testAdminSmtpConnection",
    group: "smtp",
  },
  {
    method: "POST",
    path: "/admin/v1/smtp-settings/test-email",
    operationId: "testAdminSmtpEmail",
    group: "smtp",
  },
  {
    method: "POST",
    path: "/admin/v1/smtp-settings",
    operationId: "publishAdminSmtpSettings",
    group: "smtp",
  },
  {
    method: "POST",
    path: "/admin/v1/smtp-settings/disable",
    operationId: "disableAdminSmtpSettings",
    group: "smtp",
  },
  {
    method: "GET",
    path: "/admin/v1/object-storage-settings",
    operationId: "getAdminObjectStorageSettings",
    group: "object-storage",
  },
  {
    method: "POST",
    path: "/admin/v1/object-storage-settings/test-connection",
    operationId: "testAdminObjectStorageConnection",
    group: "object-storage",
  },
  {
    method: "POST",
    path: "/admin/v1/object-storage-settings",
    operationId: "publishAdminObjectStorageSettings",
    group: "object-storage",
  },
  {
    method: "POST",
    path: "/admin/v1/object-storage-settings/restore-environment",
    operationId: "restoreAdminObjectStorageEnvironment",
    group: "object-storage",
  },
  {
    method: "POST",
    path: "/admin/v1/asset-cleanup/preview",
    operationId: "previewAdminAssetCleanup",
    group: "object-storage",
  },
  {
    method: "POST",
    path: "/admin/v1/asset-cleanup/apply",
    operationId: "applyAdminAssetCleanup",
    group: "object-storage",
  },
] as const satisfies readonly AdminRouteInventoryEntry[];

export function adminOpenApiPath(path: string) {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
}
