import type http from "node:http";
import type { MarkAnnouncementsReadRequest } from "@ai-canvas-cloud/contracts";
import {
  AnnouncementTimelineResponseSchema,
  ApiErrorResponseSchema,
  MarkAnnouncementsReadRequestSchema,
  MarkAnnouncementsReadResponseSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import type { AnnouncementTimelineService } from "@ai-canvas-cloud/server/modules/announcements";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
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
  429: ApiErrorResponseSchema,
  500: ApiErrorResponseSchema,
  503: ApiErrorResponseSchema,
};

export function registerAnnouncementRoutes(
  app: PublicFastifyInstance,
  options: {
    authContext: FastifyAuthContextAdapter;
    announcementService: AnnouncementTimelineService;
  },
) {
  app.get(
    "/api/v1/announcements",
    {
      schema: {
        operationId: "listAnnouncements",
        tags: ["announcements"],
        response: {
          200: AnnouncementTimelineResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.announcementService.list(session.user.id),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/announcements/read",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: "markAnnouncementsRead",
        tags: ["announcements"],
        body: MarkAnnouncementsReadRequestSchema,
        response: {
          200: MarkAnnouncementsReadResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        const body = request.body as MarkAnnouncementsReadRequest;
        return reply.send(
          await options.announcementService.markRead(
            session.user.id,
            body.announcementIds,
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
