import type { GenerationFailureCategory } from "./generationTelemetry.ts";

export const ADMIN_USER_LIST_DEFAULT_LIMIT = 50;
export const ADMIN_USER_LIST_MAX_LIMIT = 100;
export const ADMIN_USER_ACTION_REASON_MAX_LENGTH = 500;
export const ADMIN_USER_PASSWORD_MIN_LENGTH = 10;
export const ADMIN_USER_PASSWORD_MAX_LENGTH = 256;

export type AdminManagedUserStatus = "active" | "disabled" | "deleted";
export type AdminUserVerificationFilter = "verified" | "unverified";

export interface AdminUserListQuery {
  cursor?: string;
  limit: number;
  status?: AdminManagedUserStatus;
  verification?: AdminUserVerificationFilter;
  search?: string;
}

export interface AdminManagedUserSummary {
  id: string;
  userNumber: number;
  username: string;
  email: string;
  emailVerified: boolean;
  status: AdminManagedUserStatus;
  workspaceCount: number;
  storageUsedBytes: number;
  activeSessionCount: number;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUsersResponse {
  items: AdminManagedUserSummary[];
  nextCursor: string | null;
}

export interface AdminManagedWorkspaceSummary {
  id: string;
  name: string;
  type: "personal" | "team";
  role: "owner" | "admin" | "editor" | "viewer";
  status: "active" | "disabled" | "deleted";
  planKey: string;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  storageReservedBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserResponse {
  user: AdminManagedUserSummary;
  workspaces: AdminManagedWorkspaceSummary[];
}

export interface AdminUserActionRequest {
  reason: string;
}

export interface AdminUserStatusActionResponse {
  user: AdminManagedUserSummary;
  revokedSessionCount: number;
}

export interface AdminUserSessionRevocationResponse {
  userId: string;
  revokedSessionCount: number;
  revokedAt: string;
}

export interface AdminUserPasswordResetRequest {
  newPassword: string;
  reason: string;
}

export interface AdminUserPasswordResetResponse {
  userId: string;
  revokedSessionCount: number;
  resetAt: string;
}

export interface AdminUserDeletionSuccessor {
  id: string;
  userNumber: number;
  username: string;
}

export interface AdminUserDeletionOwnedTeam {
  id: string;
  name: string;
  successors: AdminUserDeletionSuccessor[];
}

export interface AdminUserDeletionPreview {
  userId: string;
  userNumber: number;
  personalWorkspaceCount: number;
  teamMembershipCount: number;
  ownedTeams: AdminUserDeletionOwnedTeam[];
}

export interface AdminUserOwnershipTransfer {
  workspaceId: string;
  successorUserId: string;
}

export interface AdminUserDeletionRequest {
  reason: string;
  confirmUserNumber: number;
  ownershipTransfers: AdminUserOwnershipTransfer[];
}

export interface AdminUserDeletionResponse {
  deletedAt: string;
  purgeAfter: string;
  personalWorkspaceCount: number;
  removedTeamMembershipCount: number;
}

export interface AdminDependencyHealth {
  ok: boolean;
  latencyMs: number;
  error?:
    | "connection_refused"
    | "timeout"
    | "authentication_failed"
    | "permission_denied"
    | "bucket_unavailable"
    | "unknown";
}

export interface AdminDashboardResponse {
  generatedAt: string;
  registrations: {
    total: number;
    past24Hours: number;
    past7Days: number;
    today: number;
    yesterdaySamePeriod: number;
  };
  activity: {
    activeUsers24Hours: number;
    activeUsers7Days: number;
    activeSessions: number;
  };
  storage: {
    usedBytes: number;
    reservedBytes: number;
    quotaBytes: number;
    assetCount: number;
  };
  authentication: {
    verifiedUsers: number;
    unverifiedUsers: number;
    disabledUsers: number;
  };
  generation: {
    timeZone: "Asia/Shanghai";
    today: AdminGenerationPeriodSummary;
    yesterdaySamePeriod: AdminGenerationPeriodSummary;
    daily: AdminGenerationDailySummary[];
    failures: Array<{
      category: GenerationFailureCategory;
      count: number;
    }>;
  };
  infrastructure: {
    postgres: AdminDependencyHealth;
    objectStorage: AdminDependencyHealth;
  };
}

export interface AdminGenerationPeriodSummary {
  requests: number;
  succeeded: number;
  failed: number;
  canceled: number;
  results: number;
  activeCreators: number;
  successRate: number;
  p95DurationMs: number | null;
}

export interface AdminGenerationDailySummary {
  date: string;
  text: number;
  image: number;
  video: number;
  succeeded: number;
  failed: number;
  canceled: number;
}

function requireRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Administrator request must be an object");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Administrator request contains unsupported fields");
  }
}

function optionalTrimmedString(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

export function validateAdminUserListQuery(value: unknown): AdminUserListQuery {
  const input = requireRecord(value);
  rejectUnknownKeys(
    input,
    new Set(["cursor", "limit", "status", "verification", "search"]),
  );

  const cursor = optionalTrimmedString(input.cursor, "cursor", 1_024);
  if (cursor && !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new Error("cursor is invalid");

  const rawLimit = input.limit ?? ADMIN_USER_LIST_DEFAULT_LIMIT;
  const limit =
    typeof rawLimit === "string" && /^\d+$/.test(rawLimit)
      ? Number(rawLimit)
      : rawLimit;
  if (
    !Number.isInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > ADMIN_USER_LIST_MAX_LIMIT
  ) {
    throw new Error(`limit must be between 1 and ${ADMIN_USER_LIST_MAX_LIMIT}`);
  }

  const status = optionalTrimmedString(input.status, "status", 16);
  if (
    status &&
    !(["active", "disabled", "deleted"] as const).includes(
      status as AdminManagedUserStatus,
    )
  ) {
    throw new Error("status is invalid");
  }

  const verification = optionalTrimmedString(
    input.verification,
    "verification",
    16,
  );
  if (
    verification &&
    !(["verified", "unverified"] as const).includes(
      verification as AdminUserVerificationFilter,
    )
  ) {
    throw new Error("verification is invalid");
  }

  const search = optionalTrimmedString(input.search, "search", 128);
  return {
    ...(cursor ? { cursor } : {}),
    limit: Number(limit),
    ...(status ? { status: status as AdminManagedUserStatus } : {}),
    ...(verification
      ? { verification: verification as AdminUserVerificationFilter }
      : {}),
    ...(search ? { search } : {}),
  };
}

export function validateAdminUserActionRequest(
  value: unknown,
): AdminUserActionRequest {
  const input = requireRecord(value);
  rejectUnknownKeys(input, new Set(["reason"]));
  if (typeof input.reason !== "string") throw new Error("reason is required");
  const reason = input.reason.trim();
  if (
    reason.length < 3 ||
    reason.length > ADMIN_USER_ACTION_REASON_MAX_LENGTH
  ) {
    throw new Error(
      `reason must contain between 3 and ${ADMIN_USER_ACTION_REASON_MAX_LENGTH} characters`,
    );
  }
  return { reason };
}

export function validateAdminUserPasswordResetRequest(
  value: unknown,
): AdminUserPasswordResetRequest {
  const input = requireRecord(value);
  rejectUnknownKeys(input, new Set(["newPassword", "reason"]));
  if (typeof input.newPassword !== "string") {
    throw new Error("newPassword is required");
  }
  if (
    input.newPassword.length < ADMIN_USER_PASSWORD_MIN_LENGTH ||
    input.newPassword.length > ADMIN_USER_PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `newPassword must contain between ${ADMIN_USER_PASSWORD_MIN_LENGTH} and ${ADMIN_USER_PASSWORD_MAX_LENGTH} characters`,
    );
  }
  return {
    newPassword: input.newPassword,
    reason: validateAdminUserActionRequest({ reason: input.reason }).reason,
  };
}

export function validateAdminUserDeletionRequest(
  value: unknown,
): AdminUserDeletionRequest {
  const input = requireRecord(value);
  rejectUnknownKeys(
    input,
    new Set(["reason", "confirmUserNumber", "ownershipTransfers"]),
  );
  const confirmUserNumber = input.confirmUserNumber;
  if (
    typeof confirmUserNumber !== "number" ||
    !Number.isSafeInteger(confirmUserNumber) ||
    Number(confirmUserNumber) < 10001
  ) {
    throw new Error("confirmUserNumber is invalid");
  }
  if (!Array.isArray(input.ownershipTransfers)) {
    throw new Error("ownershipTransfers must be an array");
  }
  if (input.ownershipTransfers.length > 100) {
    throw new Error("ownershipTransfers contains too many entries");
  }
  const ownershipTransfers = input.ownershipTransfers.map((item) => {
    const transfer = requireRecord(item);
    rejectUnknownKeys(transfer, new Set(["workspaceId", "successorUserId"]));
    if (
      typeof transfer.workspaceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        transfer.workspaceId,
      )
    ) {
      throw new Error("ownershipTransfers workspaceId is invalid");
    }
    return {
      workspaceId: transfer.workspaceId.toLowerCase(),
      successorUserId: validateAdminManagedUserId(transfer.successorUserId),
    };
  });
  if (
    new Set(ownershipTransfers.map((transfer) => transfer.workspaceId)).size !==
    ownershipTransfers.length
  ) {
    throw new Error("ownershipTransfers contains duplicate workspaces");
  }
  return {
    reason: validateAdminUserActionRequest({ reason: input.reason }).reason,
    confirmUserNumber,
    ownershipTransfers,
  };
}

export function validateAdminManagedUserId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("userId is invalid");
  }
  return value;
}
