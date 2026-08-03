import type http from "node:http";
import type { UpdateCanvasPreferencesRequest } from "@ai-canvas-cloud/contracts";
import {
  ApiErrorResponseSchema,
  CanvasPreferencesResponseSchema,
  UpdateCanvasPreferencesRequestSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { CanvasPreferencesService } from "@ai-canvas-cloud/server/modules/settings";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

const errorResponses = {
  400: ApiErrorResponseSchema,
  401: ApiErrorResponseSchema,
  403: ApiErrorResponseSchema,
  404: ApiErrorResponseSchema,
  429: ApiErrorResponseSchema,
  500: ApiErrorResponseSchema,
  503: ApiErrorResponseSchema,
};

export function registerSettingsRoutes(
  app: PublicFastifyInstance,
  options: {
    authContext: FastifyAuthContextAdapter;
    settingsService: CanvasPreferencesService;
  },
) {
  app.get(
    "/api/v1/settings",
    {
      schema: {
        operationId: "getCanvasPreferences",
        tags: ["settings"],
        response: { 200: CanvasPreferencesResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.settingsService.get({
            userId: session.user.id,
            workspaceId: session.workspace.id,
          }),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.patch(
    "/api/v1/settings",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: "updateCanvasPreferences",
        tags: ["settings"],
        body: UpdateCanvasPreferencesRequestSchema,
        response: { 200: CanvasPreferencesResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.settingsService.update(
            request.body as UpdateCanvasPreferencesRequest,
            {
              userId: session.user.id,
              workspaceId: session.workspace.id,
            },
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );
}
