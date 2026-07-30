import { Type, type Static } from "@sinclair/typebox";
import { apiErrorCodes } from "./index.js";
import type {
  ApiErrorCode,
  ApiErrorResponse,
  HealthResponse,
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

export type { ApiErrorSchemaCompatibility, HealthSchemaCompatibility };
