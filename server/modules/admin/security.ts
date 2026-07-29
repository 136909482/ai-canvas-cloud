import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminPermission, AdminPrincipal, AdminRole } from "./types.js";

const ROLE_PERMISSIONS: Readonly<
  Record<AdminRole, ReadonlySet<AdminPermission>>
> = {
  super_admin: new Set([
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
  ]),
  operator: new Set(["audit.read", "dashboard.read", "site_config.write"]),
  support: new Set(["audit.read", "dashboard.read", "user.read", "user.write"]),
  auditor: new Set(["audit.read", "dashboard.read"]),
};

const SECRET_KEY_PATTERN =
  /(?:authorization|api[_-]?key|token|password|secret|credential|cookie|backup|recovery)/i;
const CONTENT_KEY_PATTERN =
  /(?:prompt|content|body|response|completion|message|project|node|asset)/i;
const CREDENTIAL_VALUE_PATTERN =
  /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi;
const MAX_AUDIT_DEPTH = 5;
const MAX_AUDIT_KEYS = 64;
const MAX_AUDIT_STRING = 256;

export class AdminAccessError extends Error {
  readonly statusCode: number;
  readonly code:
    | "AUTH_REQUIRED"
    | "ADMIN_ACCESS_DENIED"
    | "RESOURCE_NOT_FOUND"
    | "VALIDATION_FAILED"
    | "SMTP_CONFIG_CONFLICT"
    | "SMTP_HOST_NOT_ALLOWED"
    | "SMTP_DNS_FAILED"
    | "SMTP_CONNECTION_FAILED"
    | "SMTP_TLS_FAILED"
    | "SMTP_AUTH_FAILED"
    | "SMTP_SENDER_REJECTED"
    | "SMTP_RECIPIENT_REJECTED"
    | "SMTP_RATE_LIMITED"
    | "OBJECT_STORAGE_CONFIG_CONFLICT"
    | "OBJECT_STORAGE_IDENTITY_LOCKED"
    | "OBJECT_STORAGE_ENVIRONMENT_FALLBACK_UNAVAILABLE"
    | "OBJECT_STORAGE_CONNECTION_FAILED"
    | "OBJECT_STORAGE_RATE_LIMITED"
    | "ASSET_CLEANUP_FAILED"
    | "SERVICE_UNAVAILABLE";

  constructor(
    statusCode: number,
    code: AdminAccessError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AdminAccessError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function assertAdminAccess(
  principal: AdminPrincipal,
  permission?: AdminPermission,
) {
  if (principal.status === "banned") {
    throw new AdminAccessError(
      403,
      "ADMIN_ACCESS_DENIED",
      "Administrator access is disabled",
    );
  }
  if (permission && !ROLE_PERMISSIONS[principal.role].has(permission)) {
    throw new AdminAccessError(
      403,
      "ADMIN_ACCESS_DENIED",
      "Administrator role is not permitted",
    );
  }
}

export function hasAdminPermission(
  role: AdminRole,
  permission: AdminPermission,
) {
  return ROLE_PERMISSIONS[role].has(permission);
}

function redactString(value: string) {
  const withoutCredentials = value.replace(
    CREDENTIAL_VALUE_PATTERN,
    "[REDACTED]",
  );
  try {
    const url = new URL(withoutCredentials);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
  } catch {
    // Non-URL audit values continue through bounded string handling.
  }
  return withoutCredentials.slice(0, MAX_AUDIT_STRING);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_AUDIT_DEPTH) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value))
    return value
      .slice(0, MAX_AUDIT_KEYS)
      .map((item) => redactValue(item, depth + 1));
  if (typeof value !== "object")
    return String(value).slice(0, MAX_AUDIT_STRING);

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_AUDIT_KEYS)) {
    if (CONTENT_KEY_PATTERN.test(key)) continue;
    output[key] = SECRET_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : redactValue(item, depth + 1);
  }
  return output;
}

export function redactAdminAuditPayload(
  value: unknown,
): Record<string, unknown> {
  const redacted = redactValue(value, 0);
  return redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}

export function hashAdminRequestIdentity(
  value: string | undefined,
  pepper: string,
) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return createHash("sha256")
    .update(pepper)
    .update("\0")
    .update(normalized)
    .digest("hex");
}

export function safeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
