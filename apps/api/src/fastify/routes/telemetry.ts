import type http from "node:http";
import {
  ApiErrorResponseSchema,
  GenerationTelemetryRequestSchema,
  GenerationTelemetryResponseSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { GenerationTelemetryService } from "@ai-canvas-cloud/server/modules/generation-telemetry";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";

interface TelemetryRouteOptions {
  authContext: FastifyAuthContextAdapter;
  generationTelemetryService: GenerationTelemetryService;
}

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

function sendAuthError(
  reply: FastifyReply,
  requestId: string,
  error: AuthServiceError,
) {
  return reply.code(error.statusCode).send({
    error: {
      code: error.apiCode,
      message: error.message,
      retryable: error.retryable,
      requestId,
      details: error.details,
    },
  });
}

export function registerTelemetryRoutes(
  app: PublicFastifyInstance,
  options: TelemetryRouteOptions,
) {
  app.post(
    "/api/v1/telemetry/generations",
    {
      bodyLimit: 2 * 1024,
      attachValidation: true,
      onRequest: async (request, reply) => {
        try {
          await options.authContext.requireSession(request);
        } catch (error) {
          if (error instanceof AuthServiceError) {
            await sendAuthError(reply, request.id, error);
            return;
          }
          throw error;
        }
      },
      schema: {
        operationId: "createGenerationTelemetry",
        tags: ["telemetry"],
        body: GenerationTelemetryRequestSchema,
        response: {
          202: GenerationTelemetryResponseSchema,
          400: ApiErrorResponseSchema,
          401: ApiErrorResponseSchema,
          403: ApiErrorResponseSchema,
          413: ApiErrorResponseSchema,
          429: ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
          503: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        const payload = await options.generationTelemetryService.record(
          request.body,
          {
            userId: session.user.id,
            workspaceId: session.workspace.id,
          },
        );
        return reply.code(202).send(payload);
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return sendAuthError(reply, request.id, error);
        }
        throw error;
      }
    },
  );
}
