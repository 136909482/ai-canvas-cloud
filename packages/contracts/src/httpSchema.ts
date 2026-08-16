import { Type, type Static } from "@sinclair/typebox";
import { apiErrorCodes } from "./index.js";
import type {
  ApiErrorCode,
  ApiErrorResponse,
  AssetCleanupRequest,
  AssetCleanupSummary,
  AssetResponse,
  AssetUploadResponse,
  AssetUrlResponse,
  AuthDevicesResponse,
  AuthSessionResponse,
  AuthSessionsResponse,
  AuthSuccessResponse,
  CurrentWorkspaceResponse,
  CanvasPreferencesResponse,
  UpdateCanvasPreferencesRequest,
  CommunityProfileResponse,
  UpdateCommunityProfileRequest,
  CommunityPostResponse,
  CreateCommunityPostRequest,
  UpdateCommunityPostRequest,
  MyCommunityPostsResponse,
  WithdrawCommunityPostResponse,
  CreateCommunityReportRequest,
  CommunityReportResponse,
  CompleteAssetUploadResponse,
  CommitMigrationImportRequest,
  CompleteMigrationImportAssetPartRequest,
  CompleteMigrationImportAssetUploadRequest,
  ApplyProjectGraphOperationsRequest,
  ApplyProjectGraphOperationsResponse,
  CreateProjectCheckpointRequest,
  CreateProjectRequest,
  CreateAssetUploadRequest,
  GenerationTelemetryRequest,
  GenerationTelemetryResponse,
  CreateGenerationTaskRecordRequest,
  GenerationTaskRecordsResponse,
  HealthResponse,
  LoginRequest,
  LogoutResponse,
  MigrationExportDownloadResponse,
  MigrationExportResponse,
  MigrationImportAssetUploadResponse,
  MigrationImportCommitResponse,
  MigrationImportResponse,
  PasswordChangeRequest,
  PasswordChangeResponse,
  PasswordForgotRequest,
  PasswordResetRequest,
  PasswordResetResponse,
  PublicSiteConfigResponse,
  PrepareMigrationExportRequest,
  PrepareMigrationImportRequest,
  ProjectCheckpointResponse,
  ProjectGraphChangesResponse,
  ProjectGraphResponse,
  ProjectResponse,
  ProjectRevisionResponse,
  ProjectRevisionRestoreResponse,
  ProjectRevisionsResponse,
  ProjectsResponse,
  RegisterRequest,
  RegistrationEmailCodeRequest,
  RegistrationEmailCodeResponse,
  RemoveDeviceResponse,
  RenameProjectRequest,
  RestoreProjectRevisionRequest,
  DeleteProjectResponse,
  RevokeSessionResponse,
  WorkspaceUsageResponse,
  AnnouncementTimelineResponse,
  MarkAnnouncementsReadRequest,
  MarkAnnouncementsReadResponse,
} from "./index.js";

const DependencyFailureSchema = Type.Union([
  Type.Literal("connection_refused"),
  Type.Literal("timeout"),
  Type.Literal("authentication_failed"),
  Type.Literal("permission_denied"),
  Type.Literal("bucket_unavailable"),
  Type.Literal("unknown"),
]);

export const ApiErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.Unsafe<ApiErrorCode>({
          type: "string",
          enum: [...apiErrorCodes],
        }),
        message: Type.String(),
        retryable: Type.Boolean(),
        requestId: Type.String(),
        details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const AnnouncementCategorySchema = Type.Union([
  Type.Literal("notice"),
  Type.Literal("product_update"),
  Type.Literal("maintenance"),
]);

export const AnnouncementTimelineResponseSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: Type.String({ format: "uuid" }),
          category: AnnouncementCategorySchema,
          title: Type.String(),
          content: Type.String(),
          publishedAt: Type.String(),
          readAt: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    unreadCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MarkAnnouncementsReadRequestSchema = Type.Object(
  {
    announcementIds: Type.Array(Type.String({ format: "uuid" }), {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const MarkAnnouncementsReadResponseSchema = Type.Object(
  {
    readAt: Type.String(),
    updatedCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AnnouncementTimelineResponseBody = Static<
  typeof AnnouncementTimelineResponseSchema
> &
  AnnouncementTimelineResponse;
export type MarkAnnouncementsReadRequestBody = Static<
  typeof MarkAnnouncementsReadRequestSchema
> &
  MarkAnnouncementsReadRequest;
export type MarkAnnouncementsReadResponseBody = Static<
  typeof MarkAnnouncementsReadResponseSchema
> &
  MarkAnnouncementsReadResponse;

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ok"), Type.Literal("degraded")]),
    service: Type.String(),
    requestId: Type.String(),
    uptimeSeconds: Type.Number({ minimum: 0 }),
    checkedAt: Type.String(),
    dependencies: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Object(
          {
            ok: Type.Boolean(),
            latencyMs: Type.Optional(Type.Number({ minimum: 0 })),
            error: Type.Optional(DependencyFailureSchema),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);

const NullableStringSchema = Type.Union([Type.String(), Type.Null()]);

const SiteConfigDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(2),
    siteName: Type.String(),
    shortName: Type.String(),
    home: Type.Object(
      {
        headline: Type.String(),
        lead: Type.String(),
        description: Type.String(),
        primaryActionLabel: Type.String(),
      },
      { additionalProperties: false },
    ),
    footer: Type.Object(
      {
        description: Type.String(),
        copyright: Type.String(),
      },
      { additionalProperties: false },
    ),
    records: Type.Object(
      {
        companyName: NullableStringSchema,
        icpNumber: NullableStringSchema,
        publicSecurityNumber: NullableStringSchema,
      },
      { additionalProperties: false },
    ),
    links: Type.Object(
      {
        helpUrl: NullableStringSchema,
        feedbackUrl: NullableStringSchema,
        termsUrl: NullableStringSchema,
        privacyUrl: NullableStringSchema,
        accountDeletionUrl: NullableStringSchema,
      },
      { additionalProperties: false },
    ),
    themePreset: Type.Union([
      Type.Literal("system"),
      Type.Literal("light"),
      Type.Literal("dark"),
    ]),
    navigation: Type.Array(
      Type.Union([
        Type.Literal("home"),
        Type.Literal("help"),
        Type.Literal("legal"),
      ]),
    ),
    features: Type.Object(
      {
        registrationEnabled: Type.Boolean(),
        registrationEmailVerificationRequired: Type.Boolean(),
        feedbackEnabled: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    logoAssetId: NullableStringSchema,
    faviconAssetId: NullableStringSchema,
  },
  { additionalProperties: false },
);

const PublicSiteAssetSchema = Type.Object(
  {
    assetId: Type.String(),
    mimeType: Type.String(),
    url: Type.String(),
    expiresAt: Type.String(),
  },
  { additionalProperties: false },
);

export const PublicSiteConfigResponseSchema = Type.Object(
  {
    etag: Type.String(),
    config: SiteConfigDocumentSchema,
    assets: Type.Object(
      {
        logo: Type.Union([PublicSiteAssetSchema, Type.Null()]),
        favicon: Type.Union([PublicSiteAssetSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const WorkspaceSummarySchema = Type.Object(
  {
    id: Type.String(),
    type: Type.Union([Type.Literal("personal"), Type.Literal("team")]),
    name: Type.String(),
    role: Type.Union([
      Type.Literal("owner"),
      Type.Literal("admin"),
      Type.Literal("editor"),
      Type.Literal("viewer"),
    ]),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("disabled"),
      Type.Literal("deleted"),
    ]),
    planKey: Type.String(),
  },
  { additionalProperties: false },
);

const UserSummarySchema = Type.Object(
  {
    id: Type.String(),
    userNumber: Type.Integer(),
    username: Type.String(),
    email: Type.String(),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("disabled"),
      Type.Literal("deleted"),
    ]),
    emailVerified: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AuthSessionResponseSchema = Type.Object(
  { user: UserSummarySchema, workspace: WorkspaceSummarySchema },
  { additionalProperties: false },
);

export const AuthSuccessResponseSchema = Type.Object(
  {
    user: UserSummarySchema,
    workspace: WorkspaceSummarySchema,
    session: Type.Object(
      { expiresAt: Type.String() },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const CommunityProfileResponseSchema = Type.Object(
  {
    profile: Type.Object(
      {
        publicNickname: NullableStringSchema,
        profileStatus: Type.Union([
          Type.Literal("active"),
          Type.Literal("hidden"),
        ]),
        communityConsentVersion: Type.Union([Type.Literal(1), Type.Null()]),
        communityConsentAt: NullableStringSchema,
        canPost: Type.Boolean(),
        updatedAt: NullableStringSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const UpdateCommunityProfileRequestSchema = Type.Object(
  {
    publicNickname: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    ),
    communityConsent: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);

export type CommunityProfileResponseBody = Static<
  typeof CommunityProfileResponseSchema
> &
  CommunityProfileResponse;
export type UpdateCommunityProfileRequestBody = Static<
  typeof UpdateCommunityProfileRequestSchema
> &
  UpdateCommunityProfileRequest;

const CommunityPostStatusSchema = Type.Union([
  Type.Literal("pending_review"),
  Type.Literal("published"),
  Type.Literal("rejected"),
  Type.Literal("withdrawn"),
  Type.Literal("removed"),
]);

export const CommunityPostSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    assetId: Type.String({ format: "uuid" }),
    title: Type.String(),
    tags: Type.Array(Type.String()),
    status: CommunityPostStatusSchema,
    moderationReason: NullableStringSchema,
    publishedAt: NullableStringSchema,
    withdrawnAt: NullableStringSchema,
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);

export const CreateCommunityPostRequestSchema = Type.Object(
  {
    assetId: Type.String({ format: "uuid" }),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 24 }), {
        maxItems: 8,
      }),
    ),
    idempotencyKey: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const UpdateCommunityPostRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 24 }), {
        maxItems: 8,
      }),
    ),
  },
  { additionalProperties: false },
);

export const CommunityPostResponseSchema = Type.Object(
  { post: CommunityPostSummarySchema },
  { additionalProperties: false },
);

export const MyCommunityPostsResponseSchema = Type.Object(
  {
    items: Type.Array(CommunityPostSummarySchema),
    nextCursor: NullableStringSchema,
  },
  { additionalProperties: false },
);

export const CommunityPublicPostSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    imageUrl: Type.String({ format: "uri" }),
    imageExpiresAt: Type.String(),
    title: Type.String(),
    tags: Type.Array(Type.String()),
    publishedAt: Type.String(),
    publicNickname: Type.String(),
  },
  { additionalProperties: false },
);

export const CommunityPublicPostsResponseSchema = Type.Object(
  {
    items: Type.Array(CommunityPublicPostSummarySchema),
    nextCursor: NullableStringSchema,
  },
  { additionalProperties: false },
);

export const CommunityPublicPostResponseSchema = Type.Object(
  { post: CommunityPublicPostSummarySchema },
  { additionalProperties: false },
);

export const WithdrawCommunityPostResponseSchema = CommunityPostResponseSchema;

const CommunityReportReasonSchema = Type.Union([
  Type.Literal("inappropriate"),
  Type.Literal("copyright"),
  Type.Literal("privacy"),
  Type.Literal("spam"),
  Type.Literal("other"),
]);

export const CreateCommunityReportRequestSchema = Type.Object(
  {
    reason: CommunityReportReasonSchema,
    detail: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const CommunityReportResponseSchema = Type.Object(
  {
    report: Type.Object(
      {
        id: Type.String({ format: "uuid" }),
        postId: Type.String({ format: "uuid" }),
        reason: CommunityReportReasonSchema,
        status: Type.Union([
          Type.Literal("pending"),
          Type.Literal("resolved"),
          Type.Literal("dismissed"),
        ]),
        createdAt: Type.String(),
        resolvedAt: NullableStringSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type CommunityPostResponseBody = Static<
  typeof CommunityPostResponseSchema
> &
  CommunityPostResponse;
export type CreateCommunityPostRequestBody = Static<
  typeof CreateCommunityPostRequestSchema
> &
  CreateCommunityPostRequest;
export type UpdateCommunityPostRequestBody = Static<
  typeof UpdateCommunityPostRequestSchema
> &
  UpdateCommunityPostRequest;
export type MyCommunityPostsResponseBody = Static<
  typeof MyCommunityPostsResponseSchema
> &
  MyCommunityPostsResponse;
export type WithdrawCommunityPostResponseBody = Static<
  typeof WithdrawCommunityPostResponseSchema
> &
  WithdrawCommunityPostResponse;
export type CreateCommunityReportRequestBody = Static<
  typeof CreateCommunityReportRequestSchema
> &
  CreateCommunityReportRequest;
export type CommunityReportResponseBody = Static<
  typeof CommunityReportResponseSchema
> &
  CommunityReportResponse;

export const RegisterRequestSchema = Type.Object(
  {
    username: Type.String(),
    email: Type.String(),
    password: Type.String(),
    acceptedTermsAndPrivacy: Type.Boolean(),
    emailVerificationCode: Type.Optional(Type.String()),
    deviceId: Type.String(),
  },
  { additionalProperties: false },
);

export const LoginRequestSchema = Type.Object(
  {
    identifier: Type.String(),
    password: Type.String(),
    deviceId: Type.String(),
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const RegistrationEmailCodeRequestSchema = Type.Object(
  { email: Type.String() },
  { additionalProperties: false },
);

export const PasswordForgotRequestSchema = RegistrationEmailCodeRequestSchema;

export const PasswordResetRequestSchema = Type.Object(
  {
    email: Type.String(),
    code: Type.String(),
    password: Type.String(),
  },
  { additionalProperties: false },
);

export const PasswordChangeRequestSchema = Type.Object(
  { currentPassword: Type.String(), newPassword: Type.String() },
  { additionalProperties: false },
);

const OkResponseSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);

export const RegistrationEmailCodeResponseSchema = Type.Object(
  { ok: Type.Literal(true), resendAfterSeconds: Type.Number() },
  { additionalProperties: false },
);

const SessionSummarySchema = Type.Object(
  {
    id: Type.String(),
    deviceLabel: NullableStringSchema,
    createdAt: Type.String(),
    lastUsedAt: Type.String(),
    expiresAt: Type.String(),
    current: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AuthSessionsResponseSchema = Type.Object(
  { sessions: Type.Array(SessionSummarySchema) },
  { additionalProperties: false },
);

const DeviceSummarySchema = Type.Object(
  {
    id: Type.String(),
    deviceLabel: NullableStringSchema,
    firstSeenAt: Type.String(),
    lastSeenAt: Type.String(),
    current: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AuthDevicesResponseSchema = Type.Object(
  { devices: Type.Array(DeviceSummarySchema) },
  { additionalProperties: false },
);

export const LogoutResponseSchema = OkResponseSchema;
export const PasswordResetResponseSchema = OkResponseSchema;
export const PasswordChangeResponseSchema = OkResponseSchema;
export const RevokeSessionResponseSchema = OkResponseSchema;
export const RemoveDeviceResponseSchema = OkResponseSchema;

export const CurrentWorkspaceResponseSchema = Type.Object(
  { workspace: WorkspaceSummarySchema },
  { additionalProperties: false },
);

export const CanvasPreferencesSchema = Type.Object(
  {
    autosaveIntervalMs: Type.Union([
      Type.Literal(15_000),
      Type.Literal(30_000),
      Type.Literal(60_000),
      Type.Literal(120_000),
      Type.Literal(300_000),
    ]),
    canvasTopBarCollapsed: Type.Boolean(),
    alignmentGuidesEnabled: Type.Boolean(),
    incomingEdgeAnimationEnabled: Type.Boolean(),
    themeMode: Type.Union([
      Type.Literal("dark"),
      Type.Literal("light"),
      Type.Literal("system"),
    ]),
    canvasPerformanceMode: Type.Union([
      Type.Literal("quality"),
      Type.Literal("performance"),
    ]),
    canvasGridEnabled: Type.Boolean(),
    edgeStyle: Type.Union([
      Type.Literal("animated"),
      Type.Literal("solid"),
      Type.Literal("step"),
      Type.Literal("smoothstep"),
    ]),
    lowQualityPreviewEnabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const UpdateCanvasPreferencesRequestSchema = Type.Partial(
  CanvasPreferencesSchema,
  { additionalProperties: false, minProperties: 1 },
);

export const CanvasPreferencesResponseSchema = Type.Object(
  {
    settings: Type.Union([CanvasPreferencesSchema, Type.Null()]),
    updatedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

const NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });

export const WorkspaceUsageResponseSchema = Type.Object(
  {
    workspaceId: Type.String(),
    storage: Type.Object(
      {
        usedBytes: NonNegativeIntegerSchema,
        reservedBytes: NonNegativeIntegerSchema,
        totalBytes: NonNegativeIntegerSchema,
        quotaBytes: NonNegativeIntegerSchema,
        availableBytes: NonNegativeIntegerSchema,
      },
      { additionalProperties: false },
    ),
    projects: Type.Array(
      Type.Object(
        {
          projectId: Type.String(),
          name: Type.String(),
          fileCount: NonNegativeIntegerSchema,
          nodeCount: NonNegativeIntegerSchema,
          storageBytes: NonNegativeIntegerSchema,
          archivedAt: NullableStringSchema,
          updatedAt: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const GenerationCategorySchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("image"),
  Type.Literal("video"),
]);
const GenerationFailureCategorySchema = Type.Union([
  Type.Literal("network"),
  Type.Literal("authentication"),
  Type.Literal("rate_limited"),
  Type.Literal("upstream"),
  Type.Literal("invalid_response"),
  Type.Literal("asset_upload"),
  Type.Literal("unknown"),
]);
const GenerationAttemptIdSchema = Type.String();
const GenerationDurationSchema = Type.Number();

export const GenerationTelemetryRequestSchema = Type.Union([
  Type.Object(
    {
      attemptId: GenerationAttemptIdSchema,
      category: GenerationCategorySchema,
      status: Type.Literal("started"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      attemptId: GenerationAttemptIdSchema,
      category: GenerationCategorySchema,
      status: Type.Literal("succeeded"),
      durationMs: GenerationDurationSchema,
      resultCount: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      attemptId: GenerationAttemptIdSchema,
      category: GenerationCategorySchema,
      status: Type.Literal("failed"),
      durationMs: GenerationDurationSchema,
      failureCategory: GenerationFailureCategorySchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      attemptId: GenerationAttemptIdSchema,
      category: GenerationCategorySchema,
      status: Type.Literal("canceled"),
      durationMs: GenerationDurationSchema,
    },
    { additionalProperties: false },
  ),
]);

export const GenerationTelemetryResponseSchema = Type.Object(
  {
    accepted: Type.Literal(true),
    attemptId: Type.String(),
    status: Type.Union([
      Type.Literal("started"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("canceled"),
    ]),
  },
  { additionalProperties: false },
);

const GenerationTaskRecordStatusSchema = Type.Union([
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("canceled"),
]);

export const CreateGenerationTaskRecordRequestSchema = Type.Object(
  {
    clientTaskId: Type.String({ format: "uuid" }),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    category: GenerationCategorySchema,
    status: GenerationTaskRecordStatusSchema,
    failureCategory: Type.Optional(
      Type.Union([GenerationFailureCategorySchema, Type.Null()]),
    ),
    resultCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })),
    durationMs: Type.Integer({ minimum: 0, maximum: 86400000 }),
    modelEntryId: Type.Optional(
      Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    ),
    assetIds: Type.Optional(
      Type.Array(Type.String({ format: "uuid" }), { maxItems: 32 }),
    ),
    startedAt: Type.String(),
    completedAt: Type.String(),
  },
  { additionalProperties: false },
);

export const GenerationTaskRecordSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    clientTaskId: Type.String({ format: "uuid" }),
    title: Type.String(),
    category: GenerationCategorySchema,
    status: GenerationTaskRecordStatusSchema,
    failureCategory: Type.Union([GenerationFailureCategorySchema, Type.Null()]),
    resultCount: Type.Integer(),
    durationMs: Type.Integer(),
    modelEntryId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    assetIds: Type.Array(Type.String({ format: "uuid" })),
    startedAt: Type.String(),
    completedAt: Type.String(),
  },
  { additionalProperties: false },
);

export const GenerationTaskRecordsResponseSchema = Type.Object(
  {
    items: Type.Array(GenerationTaskRecordSummarySchema),
    nextCursor: NullableStringSchema,
  },
  { additionalProperties: false },
);

export const GenerationTaskRecordAcceptedResponseSchema = Type.Object(
  {
    accepted: Type.Literal(true),
  },
  { additionalProperties: false },
);

const AssetKindSchema = Type.Union([
  Type.Literal("upload"),
  Type.Literal("generated"),
  Type.Literal("edit"),
  Type.Literal("crop"),
  Type.Literal("thumbnail"),
  Type.Literal("preview"),
  Type.Literal("video"),
]);
const AssetReferenceRoleSchema = Type.Union([
  Type.Literal("source"),
  Type.Literal("result"),
  Type.Literal("thumbnail"),
  Type.Literal("preview"),
  Type.Literal("mask"),
  Type.Literal("attachment"),
]);
const AssetStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("quarantined"),
  Type.Literal("deleted"),
]);
const AssetUploadStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("completed"),
  Type.Literal("expired"),
  Type.Literal("failed"),
]);

const AssetSummarySchema = Type.Object(
  {
    id: Type.String(),
    projectId: NullableStringSchema,
    originalFileName: NullableStringSchema,
    mimeType: Type.String(),
    byteSize: Type.Number(),
    sha256: NullableStringSchema,
    width: Type.Union([Type.Number(), Type.Null()]),
    height: Type.Union([Type.Number(), Type.Null()]),
    assetKind: AssetKindSchema,
    status: AssetStatusSchema,
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);

const AssetUploadSummarySchema = Type.Object(
  {
    id: Type.String(),
    assetId: Type.String(),
    projectId: NullableStringSchema,
    originalFileName: Type.String(),
    expectedMimeType: Type.String(),
    expectedByteSize: Type.Number(),
    expectedSha256: NullableStringSchema,
    assetKind: AssetKindSchema,
    status: AssetUploadStatusSchema,
    expiresAt: Type.String(),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

export const CreateAssetUploadRequestSchema =
  Type.Unsafe<CreateAssetUploadRequest>({
    type: "object",
    properties: {
      projectId: { type: ["string", "null"] },
      originalFileName: { type: "string" },
      mimeType: { type: "string" },
      byteSize: { type: "number" },
      sha256: { type: ["string", "null"] },
      width: { type: ["number", "null"] },
      height: { type: ["number", "null"] },
      assetKind: AssetKindSchema,
      referenceRole: { anyOf: [AssetReferenceRoleSchema, { type: "null" }] },
      idempotencyKey: { type: "string" },
    },
    required: [
      "originalFileName",
      "mimeType",
      "byteSize",
      "assetKind",
      "idempotencyKey",
    ],
    additionalProperties: true,
  });

export const AssetUploadResponseSchema = Type.Object(
  {
    upload: AssetUploadSummarySchema,
    asset: AssetSummarySchema,
    directUpload: Type.Object(
      {
        method: Type.Union([Type.Literal("PUT"), Type.Literal("POST")]),
        url: Type.String(),
        headers: Type.Record(Type.String(), Type.String()),
        expiresAt: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const CompleteAssetUploadResponseSchema = Type.Object(
  { upload: AssetUploadSummarySchema, asset: AssetSummarySchema },
  { additionalProperties: false },
);

export const AssetResponseSchema = Type.Object(
  { asset: AssetSummarySchema },
  { additionalProperties: false },
);

export const AssetUrlResponseSchema = Type.Object(
  { assetId: Type.String(), url: Type.String(), expiresAt: Type.String() },
  { additionalProperties: false },
);

export const AssetCleanupRequestSchema = Type.Object(
  { apply: Type.Boolean() },
  { additionalProperties: false },
);

export const AssetCleanupSummarySchema = Type.Object(
  {
    mode: Type.Union([Type.Literal("preview"), Type.Literal("apply")]),
    graceHours: NonNegativeIntegerSchema,
    cutoff: Type.String(),
    scannedAssetCount: NonNegativeIntegerSchema,
    reclaimableObjectCount: NonNegativeIntegerSchema,
    reclaimableBytes: NonNegativeIntegerSchema,
    deletedObjectCount: NonNegativeIntegerSchema,
    deletedBytes: NonNegativeIntegerSchema,
    missingObjectCount: NonNegativeIntegerSchema,
    finalizedMissingAssetCount: NonNegativeIntegerSchema,
    retainedAssetCount: NonNegativeIntegerSchema,
    truncated: Type.Boolean(),
    completedAt: Type.String(),
  },
  { additionalProperties: false },
);

const MigrationStatusErrorSchema = Type.Union([
  Type.Object(
    { code: Type.String(), message: Type.String() },
    { additionalProperties: false },
  ),
  Type.Null(),
]);
const MigrationProjectSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    version: Type.Number(),
    sequence: Type.Number(),
  },
  { additionalProperties: false },
);
const MigrationAssetKindSchema = AssetKindSchema;

export const PrepareMigrationImportRequestSchema =
  Type.Unsafe<PrepareMigrationImportRequest>({
    type: "object",
    properties: {
      idempotencyKey: { type: "string" },
      manifest: { type: "object" },
      projectRecord: { type: "object" },
      graph: { type: "object" },
      assetManifest: { type: "object" },
      checkpoint: { anyOf: [{ type: "object" }, { type: "null" }] },
      archiveEntries: { type: "array", items: { type: "object" } },
    },
    required: [
      "idempotencyKey",
      "manifest",
      "projectRecord",
      "graph",
      "assetManifest",
      "checkpoint",
      "archiveEntries",
    ],
    additionalProperties: false,
  });

const MigrationImportUploadItemSchema = Type.Object(
  {
    logicalAssetId: Type.String(),
    filePath: Type.String(),
    originalFileName: NullableStringSchema,
    mimeType: Type.String(),
    byteSize: Type.Number(),
    sha256: Type.String(),
    width: Type.Union([Type.Number(), Type.Null()]),
    height: Type.Union([Type.Number(), Type.Null()]),
    assetKind: MigrationAssetKindSchema,
    required: Type.Literal(true),
  },
  { additionalProperties: false },
);
const MigrationImportStatusSchema = Type.Union([
  Type.Literal("prepared"),
  Type.Literal("uploading"),
  Type.Literal("validating"),
  Type.Literal("ready"),
  Type.Literal("committing"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("canceled"),
  Type.Literal("expired"),
]);
export const MigrationImportResponseSchema = Type.Object(
  {
    import: Type.Object(
      {
        id: Type.String(),
        status: MigrationImportStatusSchema,
        packageId: Type.String(),
        sourcePlatform: Type.Union([
          Type.Literal("web"),
          Type.Literal("electron"),
          Type.Literal("cloud"),
        ]),
        project: Type.Object(
          {
            sourceId: Type.String(),
            name: Type.String(),
            version: Type.Number(),
            sequence: Type.Number(),
          },
          { additionalProperties: false },
        ),
        conflict: Type.Object(
          {
            type: Type.Union([
              Type.Literal("none"),
              Type.Literal("project_exists"),
              Type.Literal("project_id_unavailable"),
              Type.Literal("source_id_incompatible"),
            ]),
            requiresResolution: Type.Boolean(),
            targetProject: Type.Union([
              Type.Object(
                {
                  id: Type.String(),
                  name: Type.String(),
                  expectedVersion: Type.Number(),
                  expectedSequence: Type.Number(),
                  archivedAt: NullableStringSchema,
                },
                { additionalProperties: false },
              ),
              Type.Null(),
            ]),
          },
          { additionalProperties: false },
        ),
        allowedStrategies: Type.Array(
          Type.Union([Type.Literal("copy"), Type.Literal("replace")]),
        ),
        estimates: Type.Object(
          {
            assetCount: Type.Number(),
            fileCount: Type.Number(),
            totalBytes: Type.Number(),
            estimatedStorageBytes: Type.Number(),
            availableBytesAtPrepare: Type.Number(),
          },
          { additionalProperties: false },
        ),
        progress: Type.Object(
          {
            completedFileCount: Type.Number(),
            completedBytes: Type.Number(),
            retryCount: Type.Number(),
          },
          { additionalProperties: false },
        ),
        uploads: Type.Array(MigrationImportUploadItemSchema),
        error: MigrationStatusErrorSchema,
        cancelRequestedAt: NullableStringSchema,
        expiresAt: Type.String(),
        createdAt: Type.String(),
        updatedAt: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const CommitMigrationImportRequestSchema = Type.Object(
  {
    idempotencyKey: Type.String(),
    strategy: Type.Union([Type.Literal("copy"), Type.Literal("replace")]),
    expectedVersion: Type.Optional(Type.Number()),
    expectedSequence: Type.Optional(Type.Number()),
    confirmReplace: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const MigrationImportCommitResponseSchema = Type.Object(
  {
    importId: Type.String(),
    status: Type.Literal("completed"),
    strategy: Type.Union([Type.Literal("copy"), Type.Literal("replace")]),
    project: MigrationProjectSchema,
    assetCount: Type.Number(),
    checkpoint: Type.Union([
      Type.Object(
        {
          id: Type.String(),
          projectVersion: Type.Number(),
          sequence: Type.Number(),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const CompleteMigrationImportAssetPartRequestSchema = Type.Object(
  { etag: Type.String(), byteSize: Type.Number() },
  { additionalProperties: false },
);
export const CompleteMigrationImportAssetUploadRequestSchema = Type.Object(
  {
    parts: Type.Optional(
      Type.Record(Type.String(), CompleteMigrationImportAssetPartRequestSchema),
    ),
  },
  { additionalProperties: false },
);
const MigrationUploadStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("uploading"),
  Type.Literal("validating"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("canceled"),
  Type.Literal("expired"),
]);
const MigrationUploadPartSchema = Type.Object(
  {
    partNumber: Type.Number(),
    byteSize: Type.Number(),
    url: Type.String(),
    headers: Type.Record(Type.String(), Type.String()),
    expiresAt: Type.String(),
  },
  { additionalProperties: false },
);
export const MigrationImportAssetUploadResponseSchema = Type.Object(
  {
    upload: Type.Object(
      {
        id: Type.String(),
        importId: Type.String(),
        logicalAssetId: Type.String(),
        status: MigrationUploadStatusSchema,
        mode: Type.Union([Type.Literal("single"), Type.Literal("multipart")]),
        expectedMimeType: Type.String(),
        expectedByteSize: Type.Number(),
        expectedSha256: Type.String(),
        partSize: Type.Number(),
        partCount: Type.Number(),
        completedParts: Type.Array(Type.Number()),
        uploadedByteSize: Type.Number(),
        retryCount: Type.Number(),
        directUpload: Type.Union([
          Type.Object(
            {
              method: Type.Literal("PUT"),
              url: Type.String(),
              headers: Type.Record(Type.String(), Type.String()),
              expiresAt: Type.String(),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
        parts: Type.Array(MigrationUploadPartSchema),
        expiresAt: Type.String(),
        createdAt: Type.String(),
        updatedAt: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PrepareMigrationExportRequestSchema = Type.Object(
  {
    idempotencyKey: Type.String(),
    expectedVersion: Type.Optional(Type.Number()),
    expectedSequence: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);
const MigrationExportStatusSchema = Type.Union([
  Type.Literal("prepared"),
  Type.Literal("generating"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("canceled"),
  Type.Literal("expired"),
]);
export const MigrationExportResponseSchema = Type.Object(
  {
    export: Type.Object(
      {
        id: Type.String(),
        status: MigrationExportStatusSchema,
        project: MigrationProjectSchema,
        progress: Type.Object(
          {
            fileCount: Type.Number(),
            completedFileCount: Type.Number(),
            totalBytes: Type.Number(),
            completedBytes: Type.Number(),
            retryCount: Type.Number(),
          },
          { additionalProperties: false },
        ),
        archive: Type.Union([
          Type.Object(
            { byteSize: Type.Number(), sha256: Type.String() },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
        error: MigrationStatusErrorSchema,
        cancelRequestedAt: NullableStringSchema,
        expiresAt: Type.String(),
        createdAt: Type.String(),
        updatedAt: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const MigrationExportDownloadResponseSchema = Type.Object(
  { exportId: Type.String(), url: Type.String(), expiresAt: Type.String() },
  { additionalProperties: false },
);

const ProjectSummarySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    version: Type.Number(),
    lastSequence: Type.Number(),
    nodeCount: Type.Number(),
    edgeCount: Type.Number(),
    archivedAt: NullableStringSchema,
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);

export const ProjectResponseSchema = Type.Object(
  { project: ProjectSummarySchema },
  { additionalProperties: false },
);

export const ProjectsResponseSchema = Type.Object(
  {
    projects: Type.Array(ProjectSummarySchema),
    nextCursor: NullableStringSchema,
  },
  { additionalProperties: false },
);

export const CreateProjectRequestSchema = Type.Unsafe<CreateProjectRequest>({
  type: "object",
  properties: { id: { type: "string" }, name: { type: "string" } },
  required: ["name"],
  additionalProperties: true,
});

export const RenameProjectRequestSchema = Type.Unsafe<RenameProjectRequest>({
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
  additionalProperties: true,
});

export const DeleteProjectResponseSchema = Type.Object(
  {
    ok: Type.Literal(true),
    releasedBytes: Type.Optional(NonNegativeIntegerSchema),
  },
  { additionalProperties: false },
);

const ProjectGraphNodeSchema = Type.Object(
  {
    id: Type.String(),
    nodeType: Type.String(),
    position: Type.Object(
      { x: Type.Number(), y: Type.Number() },
      { additionalProperties: false },
    ),
    size: Type.Optional(
      Type.Object(
        { width: Type.Number(), height: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    zIndex: Type.Optional(Type.Number()),
    parentNodeId: Type.Optional(NullableStringSchema),
    dataSchemaVersion: Type.Number(),
    data: Type.Record(Type.String(), Type.Unknown()),
    presentation: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const ProjectGraphEdgeSchema = Type.Object(
  {
    id: Type.String(),
    source: Type.String(),
    target: Type.String(),
    sourceHandle: Type.Optional(NullableStringSchema),
    targetHandle: Type.Optional(NullableStringSchema),
    edgeType: Type.Optional(NullableStringSchema),
    data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const ProjectGraphOperationSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("upsertNode"), node: ProjectGraphNodeSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("deleteNode"), nodeId: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("upsertEdge"), edge: ProjectGraphEdgeSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("deleteEdge"), edgeId: Type.String() },
    { additionalProperties: false },
  ),
]);

export const ProjectGraphResponseSchema = Type.Object(
  {
    projectId: Type.String(),
    version: Type.Number(),
    sequence: Type.Number(),
    nodes: Type.Array(ProjectGraphNodeSchema),
    edges: Type.Array(ProjectGraphEdgeSchema),
  },
  { additionalProperties: false },
);

const ProjectGraphChangeSchema = Type.Object(
  {
    sequence: Type.Number(),
    baseVersion: Type.Number(),
    resultVersion: Type.Number(),
    clientId: NullableStringSchema,
    batchId: Type.String(),
    source: Type.Union([
      Type.Literal("user"),
      Type.Literal("import"),
      Type.Literal("restore"),
      Type.Literal("system"),
    ]),
    operations: Type.Array(ProjectGraphOperationSchema),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

export const ProjectGraphChangesResponseSchema = Type.Object(
  {
    projectId: Type.String(),
    version: Type.Number(),
    sequence: Type.Number(),
    after: Type.Number(),
    changes: Type.Array(ProjectGraphChangeSchema),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ApplyProjectGraphOperationsRequestSchema =
  Type.Unsafe<ApplyProjectGraphOperationsRequest>({
    type: "object",
    properties: {
      baseVersion: { type: "number" },
      clientId: { type: "string" },
      batchId: { type: "string" },
      idempotencyKey: { type: "string" },
      operations: { type: "array", items: ProjectGraphOperationSchema },
    },
    required: [
      "baseVersion",
      "clientId",
      "batchId",
      "idempotencyKey",
      "operations",
    ],
    additionalProperties: true,
  });

export const ApplyProjectGraphOperationsResponseSchema = Type.Object(
  {
    projectId: Type.String(),
    version: Type.Number(),
    sequence: Type.Number(),
    acceptedBatchId: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);

const ProjectCheckpointSummarySchema = Type.Object(
  {
    id: Type.String(),
    projectId: Type.String(),
    projectVersion: Type.Number(),
    lastSequence: Type.Number(),
    snapshotType: Type.Union([
      Type.Literal("manual"),
      Type.Literal("periodic"),
      Type.Literal("import"),
      Type.Literal("pre_restore"),
    ]),
    schemaVersion: Type.Number(),
    byteSize: Type.Number(),
    isValid: Type.Boolean(),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

export const CreateProjectCheckpointRequestSchema =
  Type.Unsafe<CreateProjectCheckpointRequest>({
    type: "object",
    properties: {
      expectedVersion: { type: "number" },
      expectedSequence: { type: "number" },
      checkpointType: { enum: ["manual", "periodic"] },
    },
    required: ["expectedVersion", "expectedSequence"],
    additionalProperties: true,
  });

export const ProjectCheckpointResponseSchema = Type.Object(
  { checkpoint: ProjectCheckpointSummarySchema, project: ProjectSummarySchema },
  { additionalProperties: false },
);

export const ProjectRevisionsResponseSchema = Type.Object(
  {
    revisions: Type.Array(ProjectCheckpointSummarySchema),
    nextCursor: NullableStringSchema,
  },
  { additionalProperties: false },
);

const ProjectRevisionRecordSchema = Type.Object(
  {
    schemaVersion: Type.Number(),
    project: Type.Object(
      {
        id: Type.String(),
        name: Type.String(),
        version: Type.Number(),
        lastSequence: Type.Number(),
      },
      { additionalProperties: false },
    ),
    canvas: Type.Object(
      {
        nodes: Type.Array(ProjectGraphNodeSchema),
        edges: Type.Array(ProjectGraphEdgeSchema),
      },
      { additionalProperties: false },
    ),
    taskQueue: Type.Object(
      { tasks: Type.Array(Type.Unknown()) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ProjectRevisionResponseSchema = Type.Object(
  {
    checkpoint: ProjectCheckpointSummarySchema,
    record: ProjectRevisionRecordSchema,
  },
  { additionalProperties: false },
);

export const RestoreProjectRevisionRequestSchema =
  Type.Unsafe<RestoreProjectRevisionRequest>({
    type: "object",
    properties: {
      expectedVersion: { type: "number" },
      expectedSequence: { type: "number" },
    },
    required: ["expectedVersion", "expectedSequence"],
    additionalProperties: true,
  });

export const ProjectRevisionRestoreResponseSchema = Type.Object(
  {
    restoredCheckpoint: ProjectCheckpointSummarySchema,
    preRestoreCheckpoint: ProjectCheckpointSummarySchema,
    project: ProjectSummarySchema,
    version: Type.Number(),
    sequence: Type.Number(),
  },
  { additionalProperties: false },
);

type Assert<T extends true> = T;
type IsMutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

type ApiErrorSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof ApiErrorResponseSchema>, ApiErrorResponse>
>;
type HealthSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof HealthResponseSchema>, HealthResponse>
>;
type PublicSiteConfigSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PublicSiteConfigResponseSchema>,
    PublicSiteConfigResponse
  >
>;
type CurrentWorkspaceSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CurrentWorkspaceResponseSchema>,
    CurrentWorkspaceResponse
  >
>;
type WorkspaceUsageSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof WorkspaceUsageResponseSchema>,
    WorkspaceUsageResponse
  >
>;
type CanvasPreferencesResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CanvasPreferencesResponseSchema>,
    CanvasPreferencesResponse
  >
>;
type UpdateCanvasPreferencesRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof UpdateCanvasPreferencesRequestSchema>,
    UpdateCanvasPreferencesRequest
  >
>;
type GenerationTelemetryRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof GenerationTelemetryRequestSchema>,
    GenerationTelemetryRequest
  >
>;
type GenerationTelemetryResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof GenerationTelemetryResponseSchema>,
    GenerationTelemetryResponse
  >
>;
type CreateGenerationTaskRecordRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CreateGenerationTaskRecordRequestSchema>,
    CreateGenerationTaskRecordRequest
  >
>;
type GenerationTaskRecordsResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof GenerationTaskRecordsResponseSchema>,
    GenerationTaskRecordsResponse
  >
>;
type CreateAssetUploadRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CreateAssetUploadRequestSchema>,
    CreateAssetUploadRequest
  >
>;
type AssetUploadResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof AssetUploadResponseSchema>,
    AssetUploadResponse
  >
>;
type CompleteAssetUploadResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CompleteAssetUploadResponseSchema>,
    CompleteAssetUploadResponse
  >
>;
type AssetResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof AssetResponseSchema>, AssetResponse>
>;
type AssetUrlResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof AssetUrlResponseSchema>, AssetUrlResponse>
>;
type AssetCleanupRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof AssetCleanupRequestSchema>,
    AssetCleanupRequest
  >
>;
type AssetCleanupSummarySchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof AssetCleanupSummarySchema>,
    AssetCleanupSummary
  >
>;
type PrepareMigrationImportRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PrepareMigrationImportRequestSchema>,
    PrepareMigrationImportRequest
  >
>;
type MigrationImportResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof MigrationImportResponseSchema>,
    MigrationImportResponse
  >
>;
type CommitMigrationImportRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CommitMigrationImportRequestSchema>,
    CommitMigrationImportRequest
  >
>;
type MigrationImportCommitResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof MigrationImportCommitResponseSchema>,
    MigrationImportCommitResponse
  >
>;
type CompleteMigrationImportAssetPartRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CompleteMigrationImportAssetPartRequestSchema>,
    CompleteMigrationImportAssetPartRequest
  >
>;
type CompleteMigrationImportAssetUploadRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CompleteMigrationImportAssetUploadRequestSchema>,
    CompleteMigrationImportAssetUploadRequest
  >
>;
type MigrationImportAssetUploadResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof MigrationImportAssetUploadResponseSchema>,
    MigrationImportAssetUploadResponse
  >
>;
type PrepareMigrationExportRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PrepareMigrationExportRequestSchema>,
    PrepareMigrationExportRequest
  >
>;
type MigrationExportResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof MigrationExportResponseSchema>,
    MigrationExportResponse
  >
>;
type MigrationExportDownloadResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof MigrationExportDownloadResponseSchema>,
    MigrationExportDownloadResponse
  >
>;
type ProjectResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof ProjectResponseSchema>, ProjectResponse>
>;
type ProjectsResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof ProjectsResponseSchema>, ProjectsResponse>
>;
type CreateProjectRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CreateProjectRequestSchema>,
    CreateProjectRequest
  >
>;
type RenameProjectRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof RenameProjectRequestSchema>,
    RenameProjectRequest
  >
>;
type DeleteProjectResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof DeleteProjectResponseSchema>,
    DeleteProjectResponse
  >
>;
type ProjectGraphResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ProjectGraphResponseSchema>,
    ProjectGraphResponse
  >
>;
type ProjectGraphChangesResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ProjectGraphChangesResponseSchema>,
    ProjectGraphChangesResponse
  >
>;
type ApplyProjectGraphOperationsRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ApplyProjectGraphOperationsRequestSchema>,
    ApplyProjectGraphOperationsRequest
  >
>;
type ApplyProjectGraphOperationsResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ApplyProjectGraphOperationsResponseSchema>,
    ApplyProjectGraphOperationsResponse
  >
>;
type CreateProjectCheckpointRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof CreateProjectCheckpointRequestSchema>,
    CreateProjectCheckpointRequest
  >
>;
type ProjectCheckpointResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ProjectCheckpointResponseSchema>,
    ProjectCheckpointResponse
  >
>;
type ProjectRevisionsResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ProjectRevisionsResponseSchema>,
    ProjectRevisionsResponse
  >
>;
type ProjectRevisionResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ProjectRevisionResponseSchema>,
    ProjectRevisionResponse
  >
>;
type RestoreProjectRevisionRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof RestoreProjectRevisionRequestSchema>,
    RestoreProjectRevisionRequest
  >
>;
type ProjectRevisionRestoreResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof ProjectRevisionRestoreResponseSchema>,
    ProjectRevisionRestoreResponse
  >
>;
type AuthSessionSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof AuthSessionResponseSchema>,
    AuthSessionResponse
  >
>;
type AuthSuccessSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof AuthSuccessResponseSchema>,
    AuthSuccessResponse
  >
>;
type RegisterSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof RegisterRequestSchema>, RegisterRequest>
>;
type LoginSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof LoginRequestSchema>, LoginRequest>
>;
type RegistrationEmailCodeRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof RegistrationEmailCodeRequestSchema>,
    RegistrationEmailCodeRequest
  >
>;
type RegistrationEmailCodeResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof RegistrationEmailCodeResponseSchema>,
    RegistrationEmailCodeResponse
  >
>;
type PasswordForgotSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PasswordForgotRequestSchema>,
    PasswordForgotRequest
  >
>;
type PasswordResetRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PasswordResetRequestSchema>,
    PasswordResetRequest
  >
>;
type PasswordResetResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PasswordResetResponseSchema>,
    PasswordResetResponse
  >
>;
type PasswordChangeRequestSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PasswordChangeRequestSchema>,
    PasswordChangeRequest
  >
>;
type PasswordChangeResponseSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof PasswordChangeResponseSchema>,
    PasswordChangeResponse
  >
>;
type AuthSessionsSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof AuthSessionsResponseSchema>,
    AuthSessionsResponse
  >
>;
type AuthDevicesSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof AuthDevicesResponseSchema>,
    AuthDevicesResponse
  >
>;
type LogoutSchemaCompatibility = Assert<
  IsMutuallyAssignable<Static<typeof LogoutResponseSchema>, LogoutResponse>
>;
type RevokeSessionSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof RevokeSessionResponseSchema>,
    RevokeSessionResponse
  >
>;
type RemoveDeviceSchemaCompatibility = Assert<
  IsMutuallyAssignable<
    Static<typeof RemoveDeviceResponseSchema>,
    RemoveDeviceResponse
  >
>;

export type {
  ApiErrorSchemaCompatibility,
  AssetCleanupRequestSchemaCompatibility,
  AssetCleanupSummarySchemaCompatibility,
  AssetResponseSchemaCompatibility,
  AssetUploadResponseSchemaCompatibility,
  AssetUrlResponseSchemaCompatibility,
  AuthDevicesSchemaCompatibility,
  AuthSessionSchemaCompatibility,
  AuthSessionsSchemaCompatibility,
  AuthSuccessSchemaCompatibility,
  CurrentWorkspaceSchemaCompatibility,
  CompleteAssetUploadResponseSchemaCompatibility,
  CommitMigrationImportRequestSchemaCompatibility,
  CompleteMigrationImportAssetPartRequestSchemaCompatibility,
  CompleteMigrationImportAssetUploadRequestSchemaCompatibility,
  CreateAssetUploadRequestSchemaCompatibility,
  CreateGenerationTaskRecordRequestSchemaCompatibility,
  CreateProjectCheckpointRequestSchemaCompatibility,
  CreateProjectRequestSchemaCompatibility,
  DeleteProjectResponseSchemaCompatibility,
  GenerationTelemetryRequestSchemaCompatibility,
  GenerationTelemetryResponseSchemaCompatibility,
  GenerationTaskRecordsResponseSchemaCompatibility,
  HealthSchemaCompatibility,
  LoginSchemaCompatibility,
  LogoutSchemaCompatibility,
  MigrationExportDownloadResponseSchemaCompatibility,
  MigrationExportResponseSchemaCompatibility,
  MigrationImportAssetUploadResponseSchemaCompatibility,
  MigrationImportCommitResponseSchemaCompatibility,
  MigrationImportResponseSchemaCompatibility,
  PasswordChangeRequestSchemaCompatibility,
  PasswordChangeResponseSchemaCompatibility,
  PasswordForgotSchemaCompatibility,
  PasswordResetRequestSchemaCompatibility,
  PasswordResetResponseSchemaCompatibility,
  PublicSiteConfigSchemaCompatibility,
  PrepareMigrationExportRequestSchemaCompatibility,
  PrepareMigrationImportRequestSchemaCompatibility,
  ProjectCheckpointResponseSchemaCompatibility,
  ProjectGraphChangesResponseSchemaCompatibility,
  ProjectGraphResponseSchemaCompatibility,
  ProjectResponseSchemaCompatibility,
  ProjectRevisionResponseSchemaCompatibility,
  ProjectRevisionRestoreResponseSchemaCompatibility,
  ProjectRevisionsResponseSchemaCompatibility,
  ProjectsResponseSchemaCompatibility,
  ApplyProjectGraphOperationsRequestSchemaCompatibility,
  ApplyProjectGraphOperationsResponseSchemaCompatibility,
  RegisterSchemaCompatibility,
  RegistrationEmailCodeRequestSchemaCompatibility,
  RegistrationEmailCodeResponseSchemaCompatibility,
  RemoveDeviceSchemaCompatibility,
  RenameProjectRequestSchemaCompatibility,
  RestoreProjectRevisionRequestSchemaCompatibility,
  RevokeSessionSchemaCompatibility,
  WorkspaceUsageSchemaCompatibility,
  CanvasPreferencesResponseSchemaCompatibility,
  UpdateCanvasPreferencesRequestSchemaCompatibility,
};
