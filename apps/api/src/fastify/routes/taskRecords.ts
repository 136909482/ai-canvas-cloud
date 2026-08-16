import type http from "node:http";
import {
  ApiErrorResponseSchema,
  CreateGenerationTaskRecordRequestSchema,
  GenerationTaskRecordAcceptedResponseSchema,
  GenerationTaskRecordsResponseSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { GenerationTaskRecordService } from "@ai-canvas-cloud/server/modules/generation-task-records";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

interface TaskRecordRouteOptions {
  authContext: FastifyAuthContextAdapter;
  generationTaskRecordService: GenerationTaskRecordService;
}

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export function registerTaskRecordRoutes(
  app: PublicFastifyInstance,
  options: TaskRecordRouteOptions,
) {
  app.post(
    "/api/v1/task-records",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: "createGenerationTaskRecord",
        tags: ["task-records"],
        body: CreateGenerationTaskRecordRequestSchema,
        response: {
          202: GenerationTaskRecordAcceptedResponseSchema,
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
        await options.generationTaskRecordService.record(request.body, {
          userId: session.user.id,
          workspaceId: session.workspace.id,
        });
        return reply.code(202).send({ accepted: true });
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return sendAuthError(reply, request.id, error);
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/task-records",
    {
      schema: {
        operationId: "listGenerationTaskRecords",
        tags: ["task-records"],
        response: {
          200: GenerationTaskRecordsResponseSchema,
          400: ApiErrorResponseSchema,
          401: ApiErrorResponseSchema,
          403: ApiErrorResponseSchema,
          429: ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
          503: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        const cursor = new URL(
          request.raw.url ?? "/",
          "http://localhost",
        ).searchParams.get("cursor");
        return reply.send(
          await options.generationTaskRecordService.listMine(
            { userId: session.user.id, workspaceId: session.workspace.id },
            cursor,
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
}
