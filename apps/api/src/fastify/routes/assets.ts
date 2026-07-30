import { createHash, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import { Type } from "@sinclair/typebox";
import {
  ApiErrorResponseSchema,
  AssetCleanupRequestSchema,
  AssetCleanupSummarySchema,
  AssetResponseSchema,
  AssetUploadResponseSchema,
  AssetUrlResponseSchema,
  CompleteAssetUploadResponseSchema,
  CreateAssetUploadRequestSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import {
  validateAssetCleanupRequest,
  type CreateAssetUploadRequest,
} from "@ai-canvas-cloud/contracts";
import type {
  AssetCleanupService,
  AssetService,
} from "@ai-canvas-cloud/server/modules/assets";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../../config.js";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

interface AssetRouteOptions {
  assetCleanupService?: AssetCleanupService;
  assetService: AssetService;
  authContext: FastifyAuthContextAdapter;
  config: Pick<ApiConfig, "assetMaintenanceToken">;
}

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

const EmptyQuerySchema = Type.Object({}, { additionalProperties: true });
const ErrorResponses = {
  400: ApiErrorResponseSchema,
  401: ApiErrorResponseSchema,
  403: ApiErrorResponseSchema,
  404: ApiErrorResponseSchema,
  409: ApiErrorResponseSchema,
  413: ApiErrorResponseSchema,
  429: ApiErrorResponseSchema,
  500: ApiErrorResponseSchema,
  503: ApiErrorResponseSchema,
};

function matchesInternalToken(
  authorization: string | undefined,
  expected: string,
) {
  if (!authorization?.startsWith("Bearer ")) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256")
    .update(authorization.slice("Bearer ".length))
    .digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

function sendCleanupAccessDenied(reply: FastifyReply, requestId: string) {
  return reply.code(403).send({
    error: {
      code: "ACCESS_DENIED",
      message: "Internal asset maintenance access denied",
      retryable: false,
      requestId,
    },
  });
}

function sendCleanupValidationError(reply: FastifyReply, requestId: string) {
  return reply.code(400).send({
    error: {
      code: "VALIDATION_FAILED",
      message: "Asset cleanup request is invalid",
      retryable: false,
      requestId,
    },
  });
}

function sendRouteNotFound(reply: FastifyReply, requestId: string) {
  return reply.code(404).send({
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "Route not found",
      retryable: true,
      requestId,
    },
  });
}

async function requireSession(
  authContext: FastifyAuthContextAdapter,
  request: Parameters<FastifyAuthContextAdapter["requireSession"]>[0],
  reply: FastifyReply,
) {
  try {
    await authContext.requireSession(request);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      await sendAuthError(reply, request.id, error);
      return;
    }
    throw error;
  }
}

export function registerAssetRoutes(
  app: PublicFastifyInstance,
  options: AssetRouteOptions,
) {
  app.post(
    "/internal/v1/asset-cleanup",
    {
      bodyLimit: 1_024,
      attachValidation: true,
      onRequest: async (request, reply) => {
        const expected = options.config.assetMaintenanceToken;
        if (
          !options.assetCleanupService ||
          !expected ||
          !matchesInternalToken(request.headers.authorization, expected)
        ) {
          await sendCleanupAccessDenied(reply, request.id);
        }
      },
      errorHandler: async (_error, request, reply) =>
        sendCleanupValidationError(reply, request.id),
      schema: {
        operationId: "runInternalAssetCleanup",
        tags: ["assets"],
        body: AssetCleanupRequestSchema,
        response: {
          200: AssetCleanupSummarySchema,
          400: ApiErrorResponseSchema,
          403: ApiErrorResponseSchema,
          503: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError) {
        return sendCleanupValidationError(reply, request.id);
      }
      const service = options.assetCleanupService;
      if (!service) {
        return sendCleanupAccessDenied(reply, request.id);
      }
      let input;
      try {
        input = validateAssetCleanupRequest(request.body);
      } catch {
        return sendCleanupValidationError(reply, request.id);
      }
      try {
        return reply.send(await service.run(input));
      } catch {
        return reply.code(503).send({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Asset cleanup failed",
            retryable: true,
            requestId: request.id,
          },
        });
      }
    },
  );

  app.post(
    "/api/v1/assets/uploads",
    {
      bodyLimit: 64 * 1024,
      attachValidation: true,
      onRequest: (request, reply) =>
        requireSession(options.authContext, request, reply),
      schema: {
        operationId: "createAssetUpload",
        tags: ["assets"],
        body: CreateAssetUploadRequestSchema,
        response: { 201: AssetUploadResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.code(201).send(
          await options.assetService.createUpload(
            request.body as CreateAssetUploadRequest,
            {
              userId: session.user.id,
              workspaceId: session.workspace.id,
            },
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return sendAuthError(reply, request.id, error);
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/assets/uploads/:uploadId/complete",
    {
      onRequest: async (request, reply) => {
        try {
          const session = await options.authContext.requireSession(request);
          await reply.send(
            await options.assetService.completeUpload(request.params.uploadId, {
              userId: session.user.id,
              workspaceId: session.workspace.id,
            }),
          );
        } catch (error) {
          if (error instanceof AuthServiceError) {
            await sendAuthError(reply, request.id, error);
            return;
          }
          throw error;
        }
      },
      schema: {
        operationId: "completeAssetUpload",
        tags: ["assets"],
        params: Type.Object(
          { uploadId: Type.String() },
          { additionalProperties: false },
        ),
        querystring: EmptyQuerySchema,
        response: { 200: CompleteAssetUploadResponseSchema, ...ErrorResponses },
      },
    },
    async (_request, reply) => reply,
  );

  app.get(
    "/api/v1/assets/:assetId",
    {
      schema: {
        operationId: "getAsset",
        tags: ["assets"],
        params: Type.Object(
          { assetId: Type.String() },
          { additionalProperties: false },
        ),
        querystring: EmptyQuerySchema,
        response: { 200: AssetResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.assetService.getAsset(request.params.assetId, {
            userId: session.user.id,
            workspaceId: session.workspace.id,
          }),
        );
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return sendAuthError(reply, request.id, error);
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/assets/:assetId/url",
    {
      schema: {
        operationId: "getAssetUrl",
        tags: ["assets"],
        params: Type.Object(
          { assetId: Type.String() },
          { additionalProperties: false },
        ),
        querystring: EmptyQuerySchema,
        response: { 200: AssetUrlResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        if (request.params.assetId === "uploads") {
          return sendRouteNotFound(reply, request.id);
        }
        return reply.send(
          await options.assetService.getAssetUrl(request.params.assetId, {
            userId: session.user.id,
            workspaceId: session.workspace.id,
          }),
        );
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return sendAuthError(reply, request.id, error);
        }
        throw error;
      }
    },
  );
}
