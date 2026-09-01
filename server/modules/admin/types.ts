export const ADMIN_ROLES = [
  "super_admin",
  "operator",
  "support",
  "auditor",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminStatus = "active" | "banned";
export type AdminAuditResult = "success" | "failure";

export const ADMIN_PERMISSIONS = [
  "audit.read",
  "dashboard.read",
  "security.write",
  "site_config.write",
  "smtp_config.write",
  "object_storage_config.write",
  "asset_maintenance.write",
  "user.read",
  "user.write",
  "user.credentials.write",
  "user.delete",
  "announcement.write",
  "community.moderate",
  "system_update.write",
  "official_generation.write",
  "credit.read",
  "credit.write",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export interface AdminPrincipal {
  id: string;
  username: string;
  role: AdminRole;
  status: AdminStatus;
}

export interface AdminSession {
  admin: AdminPrincipal;
  expiresAt: string;
}

export interface AdminRequestContext {
  requestId: string;
  cookieHeader?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminAuthResult<T> {
  response: T;
  setCookieHeaders: string[];
}

export interface AdminLoginResponse {
  state: "authenticated";
  session: AdminSession;
}

export interface AdminAuditEventInput {
  actor?: Pick<AdminPrincipal, "id" | "role">;
  action: string;
  targetType?: string;
  targetId?: string;
  result: AdminAuditResult;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  before?: unknown;
  after?: unknown;
}

export interface AdminAuditEvent {
  id: string;
  adminUserId: string | null;
  adminRole: AdminRole | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: AdminAuditResult;
  requestId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAuditPage {
  items: AdminAuditEvent[];
  nextCursor: string | null;
}
