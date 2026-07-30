import type http from "node:http";
import { Type } from "@sinclair/typebox";
import {
  ApiErrorResponseSchema,
  CurrentWorkspaceResponseSchema,
  WorkspaceUsageResponseSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { WorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

interface WorkspaceRouteOptions {
  authContext: FastifyAuthContextAdapter;
  workspaceUsageService: WorkspaceUsageService;
}

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

const EmptyQuerySchema = Type.Object({}, { additionalProperties: true });

export function registerWorkspaceRoutes(
  app: PublicFastifyInstance,
  options: WorkspaceRouteOptions,
) {
  app.get(
    "/api/v1/workspaces/current",
    {
      schema: {
        operationId: "getCurrentWorkspace",
        tags: ["workspaces"],
        querystring: EmptyQuerySchema,
        response: {
          200: CurrentWorkspaceResponseSchema,
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
        return reply.send({ workspace: session.workspace });
      } catch (error) {
        if (error instanceof AuthServiceError) {
          return sendAuthError(reply, request.id, error);
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/workspaces/current/usage",
    {
      schema: {
        operationId: "getCurrentWorkspaceUsage",
        tags: ["workspaces"],
        querystring: EmptyQuerySchema,
        response: {
          200: WorkspaceUsageResponseSchema,
          401: ApiErrorResponseSchema,
          403: ApiErrorResponseSchema,
          404: ApiErrorResponseSchema,
          429: ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
          503: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.workspaceUsageService.getCurrentUsage({
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
