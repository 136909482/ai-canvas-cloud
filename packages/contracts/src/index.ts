export const API_V1_PREFIX = "/api/v1";

export const apiErrorCodes = [
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "ACTIVE_SESSION_EXISTS",
  "USERNAME_UNAVAILABLE",
  "EMAIL_NOT_VERIFIED",
  "ACCESS_DENIED",
  "RESOURCE_NOT_FOUND",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "PROJECT_VERSION_CONFLICT",
  "PROJECT_TOO_LARGE",
  "ASSET_UPLOAD_EXPIRED",
  "ASSET_NOT_READY",
  "ASSET_VALIDATION_FAILED",
  "QUOTA_EXCEEDED",
  "IMPORT_CONFLICT",
  "IMPORT_INVALID",
  "EXPORT_CONFLICT",
  "EXPORT_NOT_READY",
  "EXPORT_EXPIRED",
  "EXPORT_CANCELED",
  "EXPORT_GENERATION_FAILED",
  "EXPORT_RETRY_EXHAUSTED",
  "PACKAGE_LIMIT_EXCEEDED",
  "SERVICE_UNAVAILABLE",
  "ADMIN_ACCESS_DENIED",
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

export interface HealthDependencyStatus {
  ok: boolean;
  latencyMs?: number;
  error?:
    | "connection_refused"
    | "timeout"
    | "authentication_failed"
    | "permission_denied"
    | "bucket_unavailable"
    | "unknown";
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  requestId: string;
  uptimeSeconds: number;
  checkedAt: string;
  dependencies?: Record<string, HealthDependencyStatus>;
}

export type UserStatus = "active" | "disabled" | "deleted";
export type WorkspaceType = "personal" | "team";
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type WorkspaceStatus = "active" | "disabled" | "deleted";

export interface UserSummary {
  id: string;
  userNumber: number;
  username: string;
  email: string;
  status: UserStatus;
  emailVerified: boolean;
}

export interface WorkspaceSummary {
  id: string;
  type: WorkspaceType;
  name: string;
  role: WorkspaceRole;
  status: WorkspaceStatus;
  planKey: string;
}

export interface CurrentWorkspaceResponse {
  workspace: WorkspaceSummary;
}

export interface WorkspaceStorageUsageSummary {
  usedBytes: number;
  reservedBytes: number;
  totalBytes: number;
  quotaBytes: number;
  availableBytes: number;
}

export interface WorkspaceProjectStorageSummary {
  projectId: string;
  name: string;
  fileCount: number;
  nodeCount: number;
  storageBytes: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface WorkspaceUsageResponse {
  workspaceId: string;
  storage: WorkspaceStorageUsageSummary;
  projects: WorkspaceProjectStorageSummary[];
}

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AuthSessionsResponse {
  sessions: SessionSummary[];
}

export interface RevokeSessionResponse {
  ok: true;
}

export interface DeviceSummary {
  id: string;
  deviceLabel: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AuthDevicesResponse {
  devices: DeviceSummary[];
}

export interface RemoveDeviceResponse {
  ok: true;
}

export interface AuthSessionResponse {
  user: UserSummary;
  workspace: WorkspaceSummary;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  emailVerificationCode?: string;
  deviceId?: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
  deviceId?: string;
  force?: boolean;
}

export interface AuthSuccessResponse {
  user: UserSummary;
  workspace: WorkspaceSummary;
  session: {
    expiresAt: string;
  };
}

export interface PasswordForgotRequest {
  email: string;
}

export interface PasswordResetRequest {
  email: string;
  code: string;
  password: string;
}

export interface PasswordResetResponse {
  ok: true;
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

export interface PasswordChangeResponse {
  ok: true;
}

export interface RegistrationEmailCodeRequest {
  email: string;
}

export interface RegistrationEmailCodeResponse {
  ok: true;
  resendAfterSeconds: number;
}

export interface LogoutResponse {
  ok: true;
}

export type ProjectListStatus = "active" | "archived";

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  lastSequence: number;
  nodeCount: number;
  edgeCount: number;
  taskCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectResponse {
  project: ProjectSummary;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
  nextCursor: string | null;
}

export interface CreateProjectRequest {
  id?: string;
  name: string;
}

export interface RenameProjectRequest {
  name: string;
}

export interface DeleteProjectResponse {
  ok: true;
}

export interface ProjectGraphNode {
  id: string;
  nodeType: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  zIndex?: number;
  parentNodeId?: string | null;
  dataSchemaVersion: number;
  data: Record<string, unknown>;
  presentation?: Record<string, unknown>;
}

export interface ProjectGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  edgeType?: string | null;
  data?: Record<string, unknown>;
}

export type ProjectGraphOperation =
  | { type: "upsertNode"; node: ProjectGraphNode }
  | { type: "deleteNode"; nodeId: string }
  | { type: "upsertEdge"; edge: ProjectGraphEdge }
  | { type: "deleteEdge"; edgeId: string };

export type ProjectGraphChangeSource =
  "user" | "worker" | "import" | "restore" | "system";

export interface ProjectGraphChange {
  sequence: number;
  baseVersion: number;
  resultVersion: number;
  clientId: string | null;
  batchId: string;
  source: ProjectGraphChangeSource;
  operations: ProjectGraphOperation[];
  createdAt: string;
}

export interface ProjectGraphResponse {
  projectId: string;
  version: number;
  sequence: number;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
}

export interface ProjectGraphChangesResponse {
  projectId: string;
  version: number;
  sequence: number;
  after: number;
  changes: ProjectGraphChange[];
  hasMore: boolean;
}

export type ProjectCheckpointType =
  "manual" | "periodic" | "import" | "pre_restore";

export interface CreateProjectCheckpointRequest {
  expectedVersion: number;
  expectedSequence: number;
  checkpointType?: Extract<ProjectCheckpointType, "manual" | "periodic">;
}

export interface ProjectCheckpointSummary {
  id: string;
  projectId: string;
  projectVersion: number;
  lastSequence: number;
  snapshotType: ProjectCheckpointType;
  schemaVersion: number;
  byteSize: number;
  isValid: boolean;
  createdAt: string;
}

export interface ProjectCheckpointResponse {
  checkpoint: ProjectCheckpointSummary;
  project: ProjectSummary;
}

export interface ProjectRevisionsResponse {
  revisions: ProjectCheckpointSummary[];
  nextCursor: string | null;
}

export interface ProjectRevisionRecord {
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    version: number;
    lastSequence: number;
  };
  canvas: {
    nodes: ProjectGraphNode[];
    edges: ProjectGraphEdge[];
  };
  taskQueue: {
    tasks: unknown[];
  };
}

export interface ProjectRevisionResponse {
  checkpoint: ProjectCheckpointSummary;
  record: ProjectRevisionRecord;
}

export interface RestoreProjectRevisionRequest {
  expectedVersion: number;
  expectedSequence: number;
}

export interface ProjectRevisionRestoreResponse {
  restoredCheckpoint: ProjectCheckpointSummary;
  preRestoreCheckpoint: ProjectCheckpointSummary;
  project: ProjectSummary;
  version: number;
  sequence: number;
}

export type AssetKind =
  "upload" | "generated" | "edit" | "crop" | "thumbnail" | "preview" | "video";
export type AssetStatus =
  "pending" | "completed" | "failed" | "quarantined" | "deleted";
export type AssetUploadStatus = "pending" | "completed" | "expired" | "failed";
export type AssetReferenceRole =
  "source" | "result" | "thumbnail" | "preview" | "mask" | "attachment";

export interface AssetSummary {
  id: string;
  projectId: string | null;
  originalFileName: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  assetKind: AssetKind;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetUploadRequest {
  projectId?: string | null;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  assetKind: AssetKind;
  referenceRole?: AssetReferenceRole;
  idempotencyKey: string;
}

export interface AssetUploadSummary {
  id: string;
  assetId: string;
  projectId: string | null;
  originalFileName: string;
  expectedMimeType: string;
  expectedByteSize: number;
  expectedSha256: string | null;
  assetKind: AssetKind;
  status: AssetUploadStatus;
  expiresAt: string;
  createdAt: string;
}

export interface AssetUploadResponse {
  upload: AssetUploadSummary;
  asset: AssetSummary;
  directUpload: {
    method: "PUT" | "POST";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
}

export interface CompleteAssetUploadResponse {
  upload: AssetUploadSummary;
  asset: AssetSummary;
}

export interface AssetResponse {
  asset: AssetSummary;
}

export interface AssetUrlResponse {
  assetId: string;
  url: string;
  expiresAt: string;
}

export interface ApplyProjectGraphOperationsRequest {
  baseVersion: number;
  clientId: string;
  batchId: string;
  idempotencyKey: string;
  operations: ProjectGraphOperation[];
}

export interface ApplyProjectGraphOperationsResponse {
  projectId: string;
  version: number;
  sequence: number;
  acceptedBatchId: string;
  updatedAt: string;
}

export type AdminRole = "super_admin" | "operator" | "support" | "auditor";
export type AdminStatus = "active" | "banned";

export interface AdminPrincipal {
  id: string;
  username: string;
  role: AdminRole;
  status: AdminStatus;
}

export interface AdminSessionResponse {
  admin: AdminPrincipal;
  expiresAt: string;
}

export interface AdminLoginResponse {
  state: "authenticated";
  session: AdminSessionResponse;
}

export interface AdminCaptchaResponse {
  enabled: boolean;
  challenge: {
    id: string;
    imageDataUrl: string;
    expiresAt: string;
  } | null;
}

export interface AdminLoginSecuritySettingsResponse {
  captchaEnabled: boolean;
  updatedAt: string;
}

export interface AdminUsernameUpdateRequest {
  username: string;
}

export interface AdminPasswordUpdateRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AdminAuditEvent {
  id: string;
  adminUserId: string | null;
  adminRole: AdminRole | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: "success" | "failure";
  requestId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAuditEventsResponse {
  items: AdminAuditEvent[];
  nextCursor: string | null;
}

export interface AdminCsrfResponse {
  token: string;
}

export function createServiceUnavailableError(
  requestId: string,
  message = "Service unavailable",
): ApiErrorResponse {
  return {
    error: {
      code: "SERVICE_UNAVAILABLE",
      message,
      retryable: true,
      requestId,
    },
  };
}

export * from "./migrationPackage.ts";
export * from "./migrationExport.ts";
export * from "./siteConfig.ts";
export * from "./adminOperations.ts";
export * from "./generationTelemetry.ts";
export * from "./smtpSettings.ts";
export * from "./objectStorageSettings.ts";
