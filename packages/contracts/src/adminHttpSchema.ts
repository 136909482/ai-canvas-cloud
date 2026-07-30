import { Type } from "@sinclair/typebox";

export const AdminJsonObjectSchema = Type.Object(
  {},
  { additionalProperties: true },
);

export const AdminErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
        retryable: Type.Boolean(),
        requestId: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AdminCsrfResponseSchema = Type.Object(
  { token: Type.String() },
  { additionalProperties: false },
);

export const AdminHealthResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ok"), Type.Literal("degraded")]),
    service: Type.Literal("admin-api"),
    requestId: Type.String(),
    dependencies: Type.Optional(AdminJsonObjectSchema),
    checkedAt: Type.String(),
  },
  { additionalProperties: false },
);

export const AdminLoginRequestSchema = Type.Object(
  {
    username: Type.String(),
    password: Type.String(),
    captchaChallengeId: Type.Optional(Type.String()),
    captchaCode: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export const AdminUsernameRequestSchema = Type.Object(
  { username: Type.String() },
  { additionalProperties: true },
);

export const AdminPasswordRequestSchema = Type.Object(
  { currentPassword: Type.String(), newPassword: Type.String() },
  { additionalProperties: true },
);

export const AdminLoginSecurityRequestSchema = Type.Object(
  { captchaEnabled: Type.Boolean() },
  { additionalProperties: true },
);

export const AdminPathIdSchema = Type.Object(
  { userId: Type.String() },
  { additionalProperties: false },
);

export const AdminSiteAssetPathSchema = Type.Object(
  { assetId: Type.String() },
  { additionalProperties: false },
);

export const AdminRequestBodySchema = AdminJsonObjectSchema;
export const AdminResponseBodySchema = AdminJsonObjectSchema;
