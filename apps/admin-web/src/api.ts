import type {
  AdminAuditEventsResponse,
  AdminCaptchaResponse,
  AdminCsrfResponse,
  AdminDashboardResponse,
  AdminLoginSecuritySettingsResponse,
  AdminLoginResponse,
  AdminManagedUserStatus,
  AdminPasswordUpdateRequest,
  AdminSessionResponse,
  AdminSiteConfigResponse,
  AdminUsersResponse,
  AdminUserActionRequest,
  AdminUserDeletionPreview,
  AdminUserDeletionRequest,
  AdminUserDeletionResponse,
  AdminUserResponse,
  AdminUserPasswordResetRequest,
  AdminUserPasswordResetResponse,
  AdminUserSessionRevocationResponse,
  AdminUserStatusActionResponse,
  AdminUserVerificationFilter,
  AdminUsernameUpdateRequest,
  PublishSiteConfigRequest,
  SiteAssetKind,
  SiteAssetResponse,
  SiteAssetsResponse,
  SiteAssetUploadResponse,
  DisableSmtpSettingsInput,
  SmtpSettingsInput,
  SmtpSettingsResponse,
  SmtpTestEmailInput,
  SmtpTestResponse,
  ObjectStorageSettingsInput,
  ObjectStorageSettingsResponse,
  ObjectStorageTestResponse,
  RestoreEnvironmentObjectStorageInput,
  AssetCleanupSummary,
  AdminAnnouncementsResponse,
  AnnouncementActionResponse,
  SaveAnnouncementDraftRequest,
} from "@ai-canvas-cloud/contracts";

const configuredApiUrl = (
  import.meta.env.VITE_ADMIN_API_URL as string | undefined
)?.replace(/\/$/, "");
const API_URL =
  configuredApiUrl ?? (import.meta.env.DEV ? "http://127.0.0.1:8788" : "");
let csrfToken: string | null = null;

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    throw new AdminApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "SERVICE_UNAVAILABLE",
      typeof error?.message === "string" ? error.message : "管理服务暂时不可用",
    );
  }
  return payload as T;
}

async function refreshCsrf() {
  const response = await fetch(`${API_URL}/admin/v1/auth/csrf`, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const payload = await parseResponse<AdminCsrfResponse>(response);
  csrfToken = payload.token;
  return payload.token;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retryCsrf = true,
): Promise<T> {
  const method = init.method ?? "GET";
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  const token = isWrite ? (csrfToken ?? (await refreshCsrf())) : null;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { "x-csrf-token": token } : {}),
      ...init.headers,
    },
  });
  if (isWrite && response.status === 403 && retryCsrf) {
    csrfToken = null;
    await refreshCsrf();
    return request<T>(path, init, false);
  }
  return parseResponse<T>(response);
}

function post<T>(path: string, body: Record<string, unknown> = {}) {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export const adminApi = {
  captcha() {
    return request<AdminCaptchaResponse>("/admin/v1/auth/captcha");
  },
  login(
    username: string,
    password: string,
    captcha?: { challengeId: string; code: string },
  ) {
    return post<AdminLoginResponse>("/admin/v1/auth/login", {
      username,
      password,
      ...(captcha
        ? { captchaChallengeId: captcha.challengeId, captchaCode: captcha.code }
        : {}),
    });
  },
  session() {
    return request<AdminSessionResponse>("/admin/v1/auth/session");
  },
  loginSecuritySettings() {
    return request<AdminLoginSecuritySettingsResponse>(
      "/admin/v1/auth/login-security",
    );
  },
  updateLoginSecuritySettings(captchaEnabled: boolean) {
    return post<AdminLoginSecuritySettingsResponse>(
      "/admin/v1/auth/login-security",
      { captchaEnabled },
    );
  },
  updateUsername(input: AdminUsernameUpdateRequest) {
    return post<AdminSessionResponse>(
      "/admin/v1/auth/username",
      input as unknown as Record<string, unknown>,
    );
  },
  changePassword(input: AdminPasswordUpdateRequest) {
    return post<AdminSessionResponse>(
      "/admin/v1/auth/password",
      input as unknown as Record<string, unknown>,
    );
  },
  async logout() {
    await post<{ success: true }>("/admin/v1/auth/logout");
    csrfToken = null;
  },
  auditEvents(
    params: {
      cursor?: string;
      limit?: number;
      action?: string;
      result?: string;
    } = {},
  ) {
    const query = new URLSearchParams();
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.action) query.set("action", params.action);
    if (params.result) query.set("result", params.result);
    return request<AdminAuditEventsResponse>(
      `/admin/v1/audit-events${query.size ? `?${query}` : ""}`,
    );
  },
  dashboard() {
    return request<AdminDashboardResponse>("/admin/v1/dashboard");
  },
  announcements() {
    return request<AdminAnnouncementsResponse>("/admin/v1/announcements");
  },
  createAnnouncementDraft(input: SaveAnnouncementDraftRequest) {
    return post<AnnouncementActionResponse>(
      "/admin/v1/announcements",
      input as unknown as Record<string, unknown>,
    );
  },
  updateAnnouncementDraft(id: string, input: SaveAnnouncementDraftRequest) {
    return post<AnnouncementActionResponse>(
      `/admin/v1/announcements/${encodeURIComponent(id)}`,
      input as unknown as Record<string, unknown>,
    );
  },
  publishAnnouncement(id: string) {
    return post<AnnouncementActionResponse>(
      `/admin/v1/announcements/${encodeURIComponent(id)}/publish`,
    );
  },
  archiveAnnouncement(id: string) {
    return post<AnnouncementActionResponse>(
      `/admin/v1/announcements/${encodeURIComponent(id)}/archive`,
    );
  },
  users(
    params: {
      cursor?: string;
      limit?: number;
      status?: AdminManagedUserStatus;
      verification?: AdminUserVerificationFilter;
      search?: string;
    } = {},
  ) {
    const query = new URLSearchParams();
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.status) query.set("status", params.status);
    if (params.verification) query.set("verification", params.verification);
    if (params.search) query.set("search", params.search);
    return request<AdminUsersResponse>(
      `/admin/v1/users${query.size ? `?${query}` : ""}`,
    );
  },
  user(userId: string) {
    return request<AdminUserResponse>(
      `/admin/v1/users/${encodeURIComponent(userId)}`,
    );
  },
  userDeletionPreview(userId: string) {
    return request<AdminUserDeletionPreview>(
      `/admin/v1/users/${encodeURIComponent(userId)}/deletion-preview`,
    );
  },
  deleteUser(userId: string, input: AdminUserDeletionRequest) {
    return post<AdminUserDeletionResponse>(
      `/admin/v1/users/${encodeURIComponent(userId)}/delete`,
      input as unknown as Record<string, unknown>,
    );
  },
  banUser(userId: string, input: AdminUserActionRequest) {
    return post<AdminUserStatusActionResponse>(
      `/admin/v1/users/${encodeURIComponent(userId)}/ban`,
      input as unknown as Record<string, unknown>,
    );
  },
  unbanUser(userId: string, input: AdminUserActionRequest) {
    return post<AdminUserStatusActionResponse>(
      `/admin/v1/users/${encodeURIComponent(userId)}/unban`,
      input as unknown as Record<string, unknown>,
    );
  },
  revokeUserSessions(userId: string, input: AdminUserActionRequest) {
    return post<AdminUserSessionRevocationResponse>(
      `/admin/v1/users/${encodeURIComponent(userId)}/revoke-sessions`,
      input as unknown as Record<string, unknown>,
    );
  },
  resetUserPassword(userId: string, input: AdminUserPasswordResetRequest) {
    return post<AdminUserPasswordResetResponse>(
      `/admin/v1/users/${encodeURIComponent(userId)}/reset-password`,
      input as unknown as Record<string, unknown>,
    );
  },
  smtpSettings() {
    return request<SmtpSettingsResponse>("/admin/v1/smtp-settings");
  },
  testSmtpConnection(input: SmtpSettingsInput) {
    return post<SmtpTestResponse>(
      "/admin/v1/smtp-settings/test-connection",
      input as unknown as Record<string, unknown>,
    );
  },
  testSmtpEmail(input: SmtpTestEmailInput) {
    return post<SmtpTestResponse>(
      "/admin/v1/smtp-settings/test-email",
      input as unknown as Record<string, unknown>,
    );
  },
  publishSmtpSettings(input: SmtpSettingsInput) {
    return post<SmtpSettingsResponse>(
      "/admin/v1/smtp-settings",
      input as unknown as Record<string, unknown>,
    );
  },
  disableSmtpSettings(input: DisableSmtpSettingsInput) {
    return post<SmtpSettingsResponse>(
      "/admin/v1/smtp-settings/disable",
      input as unknown as Record<string, unknown>,
    );
  },
  objectStorageSettings() {
    return request<ObjectStorageSettingsResponse>(
      "/admin/v1/object-storage-settings",
    );
  },
  testObjectStorageConnection(input: ObjectStorageSettingsInput) {
    return post<ObjectStorageTestResponse>(
      "/admin/v1/object-storage-settings/test-connection",
      input as unknown as Record<string, unknown>,
    );
  },
  publishObjectStorageSettings(input: ObjectStorageSettingsInput) {
    return post<ObjectStorageSettingsResponse>(
      "/admin/v1/object-storage-settings",
      input as unknown as Record<string, unknown>,
    );
  },
  restoreEnvironmentObjectStorage(input: RestoreEnvironmentObjectStorageInput) {
    return post<ObjectStorageSettingsResponse>(
      "/admin/v1/object-storage-settings/restore-environment",
      input as unknown as Record<string, unknown>,
    );
  },
  previewAssetCleanup() {
    return post<AssetCleanupSummary>("/admin/v1/asset-cleanup/preview");
  },
  applyAssetCleanup() {
    return post<AssetCleanupSummary>("/admin/v1/asset-cleanup/apply");
  },
  siteConfig() {
    return request<AdminSiteConfigResponse>("/admin/v1/site-config");
  },
  publishSiteConfig(input: PublishSiteConfigRequest) {
    return post<AdminSiteConfigResponse>(
      "/admin/v1/site-config",
      input as unknown as Record<string, unknown>,
    );
  },
  siteAssets() {
    return request<SiteAssetsResponse>("/admin/v1/site-assets");
  },
  async uploadSiteAsset(kind: SiteAssetKind, file: File) {
    const bytes = await file.arrayBuffer();
    const mimeType =
      file.type === "image/vnd.microsoft.icon" ||
      (!file.type && file.name.toLowerCase().endsWith(".ico"))
        ? "image/x-icon"
        : file.type;
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const created = await post<SiteAssetUploadResponse>(
      "/admin/v1/site-assets",
      {
        kind,
        originalFileName: file.name,
        mimeType,
        byteSize: file.size,
        sha256,
        ...dimensions,
        idempotencyKey: `site-${kind}-${crypto.randomUUID()}`,
      },
    );
    const uploaded = await fetch(created.directUpload.url, {
      method: created.directUpload.method,
      headers: created.directUpload.headers,
      body: file,
      credentials: "omit",
    });
    if (!uploaded.ok)
      throw new AdminApiError(
        uploaded.status,
        "SITE_ASSET_UPLOAD_FAILED",
        "品牌资产上传失败",
      );
    return post<SiteAssetResponse>(
      `/admin/v1/site-assets/${created.asset.id}/complete`,
    );
  },
};
