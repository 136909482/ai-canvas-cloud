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
  CompleteAssetUploadResponse,
  CreateAssetUploadRequest,
  GenerationTelemetryRequest,
  GenerationTelemetryResponse,
  HealthResponse,
  LoginRequest,
  LogoutResponse,
  PasswordChangeRequest,
  PasswordChangeResponse,
  PasswordForgotRequest,
  PasswordResetRequest,
  PasswordResetResponse,
  PublicSiteConfigResponse,
  RegisterRequest,
  RegistrationEmailCodeRequest,
  RegistrationEmailCodeResponse,
  RemoveDeviceResponse,
  RevokeSessionResponse,
  WorkspaceUsageResponse,
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

export const RegisterRequestSchema = Type.Object(
  {
    username: Type.String(),
    email: Type.String(),
    password: Type.String(),
    acceptedTermsAndPrivacy: Type.Boolean(),
    emailVerificationCode: Type.Optional(Type.String()),
    deviceId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const LoginRequestSchema = Type.Object(
  {
    identifier: Type.String(),
    password: Type.String(),
    deviceId: Type.Optional(Type.String()),
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
  CreateAssetUploadRequestSchemaCompatibility,
  GenerationTelemetryRequestSchemaCompatibility,
  GenerationTelemetryResponseSchemaCompatibility,
  HealthSchemaCompatibility,
  LoginSchemaCompatibility,
  LogoutSchemaCompatibility,
  PasswordChangeRequestSchemaCompatibility,
  PasswordChangeResponseSchemaCompatibility,
  PasswordForgotSchemaCompatibility,
  PasswordResetRequestSchemaCompatibility,
  PasswordResetResponseSchemaCompatibility,
  PublicSiteConfigSchemaCompatibility,
  RegisterSchemaCompatibility,
  RegistrationEmailCodeRequestSchemaCompatibility,
  RegistrationEmailCodeResponseSchemaCompatibility,
  RemoveDeviceSchemaCompatibility,
  RevokeSessionSchemaCompatibility,
  WorkspaceUsageSchemaCompatibility,
};
