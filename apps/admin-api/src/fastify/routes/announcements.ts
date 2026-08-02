import type { SaveAnnouncementDraftRequest } from "@ai-canvas-cloud/contracts";
import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminRequestBodySchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type { AdminAnnouncementService } from "@ai-canvas-cloud/server/modules/announcements";
import type { AdminApiConfig } from "../../config.js";
import { adminOperation, adminRequestContext, bodyRecord } from "../helpers.js";
import type { AdminFastifyInstance } from "../types.js";

const responses = {
  200: AdminJsonObjectSchema,
  400: AdminErrorResponseSchema,
  401: AdminErrorResponseSchema,
  403: AdminErrorResponseSchema,
  404: AdminErrorResponseSchema,
  409: AdminErrorResponseSchema,
  500: AdminErrorResponseSchema,
  503: AdminErrorResponseSchema,
};

export function registerAdminAnnouncementRoutes(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    announcementService: AdminAnnouncementService;
  },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);

  app.get(
    "/admin/v1/announcements",
    {
      schema: {
        operationId: adminOperation("listAdminAnnouncements"),
        tags: ["announcements"],
        response: responses,
      },
    },
    async (request) => options.announcementService.list(context(request)),
  );

  app.post(
    "/admin/v1/announcements",
    {
      bodyLimit: 8 * 1024,
      schema: {
        operationId: adminOperation("createAdminAnnouncementDraft"),
        tags: ["announcements"],
        body: AdminRequestBodySchema,
        response: { ...responses, 201: AdminJsonObjectSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await options.announcementService.createDraft(
            bodyRecord(request.body) as unknown as SaveAnnouncementDraftRequest,
            context(request),
          ),
        ),
  );

  app.post(
    "/admin/v1/announcements/:announcementId",
    {
      bodyLimit: 8 * 1024,
      schema: {
        operationId: adminOperation("updateAdminAnnouncementDraft"),
        tags: ["announcements"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.announcementService.updateDraft(
        (request.params as { announcementId: string }).announcementId,
        bodyRecord(request.body) as unknown as SaveAnnouncementDraftRequest,
        context(request),
      ),
  );

  app.post(
    "/admin/v1/announcements/:announcementId/publish",
    {
      schema: {
        operationId: adminOperation("publishAdminAnnouncement"),
        tags: ["announcements"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.announcementService.publish(
        (request.params as { announcementId: string }).announcementId,
        context(request),
      ),
  );

  app.post(
    "/admin/v1/announcements/:announcementId/archive",
    {
      schema: {
        operationId: adminOperation("archiveAdminAnnouncement"),
        tags: ["announcements"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.announcementService.archive(
        (request.params as { announcementId: string }).announcementId,
        context(request),
      ),
  );
}
