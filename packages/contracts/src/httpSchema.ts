import { Type, type Static } from "@sinclair/typebox";
import { apiErrorCodes } from "./index.js";
import type {
  ApiErrorCode,
  ApiErrorResponse,
  CurrentWorkspaceResponse,
  GenerationTelemetryRequest,
  GenerationTelemetryResponse,
  HealthResponse,
  PublicSiteConfigResponse,
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

export type {
  ApiErrorSchemaCompatibility,
  CurrentWorkspaceSchemaCompatibility,
  GenerationTelemetryRequestSchemaCompatibility,
  GenerationTelemetryResponseSchemaCompatibility,
  HealthSchemaCompatibility,
  PublicSiteConfigSchemaCompatibility,
  WorkspaceUsageSchemaCompatibility,
};
