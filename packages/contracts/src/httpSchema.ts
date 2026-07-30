import { Type, type Static } from "@sinclair/typebox";
import { apiErrorCodes } from "./index.js";
import type {
  ApiErrorCode,
  ApiErrorResponse,
  HealthResponse,
  PublicSiteConfigResponse,
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

type Assert<T extends true> = T;
type IsMutuallyAssignable<Left, Right> = Left extends Right
  ? Right extends Left
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

export type {
  ApiErrorSchemaCompatibility,
  HealthSchemaCompatibility,
  PublicSiteConfigSchemaCompatibility,
};
