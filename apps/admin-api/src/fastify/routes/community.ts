import type {
  CommunityPostStatus,
  ModerateCommunityPostRequest,
  ResolveCommunityReportRequest,
} from "@ai-canvas-cloud/contracts";
import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminRequestBodySchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type { AdminCommunityModerationService } from "@ai-canvas-cloud/server/modules/community";
import type { AdminApiConfig } from "../../config.js";
import {
  adminOperation,
  adminRequestContext,
  bodyRecord,
  queryDocument,
} from "../helpers.js";
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

export function registerAdminCommunityRoutes(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    communityModerationService: AdminCommunityModerationService;
  },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);
  const postId = (request: { params: unknown }) =>
    (request.params as { postId: string }).postId;

  app.get(
    "/admin/v1/community/posts",
    {
      schema: {
        operationId: adminOperation("listAdminCommunityPosts"),
        tags: ["community"],
        response: responses,
      },
    },
    async (request) =>
      options.communityModerationService.listPosts(
        queryDocument(request).status as CommunityPostStatus | undefined,
        context(request),
      ),
  );

  app.post(
    "/admin/v1/community/posts/:postId/approve",
    {
      schema: {
        operationId: adminOperation("approveCommunityPost"),
        tags: ["community"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.communityModerationService.approve(
        postId(request),
        context(request),
      ),
  );

  for (const action of ["reject", "remove"] as const) {
    app.post(
      `/admin/v1/community/posts/:postId/${action}`,
      {
        schema: {
          operationId: adminOperation(`${action}CommunityPost`),
          tags: ["community"],
          body: AdminRequestBodySchema,
          response: responses,
        },
      },
      async (request) =>
        options.communityModerationService[action](
          postId(request),
          bodyRecord(request.body) as unknown as ModerateCommunityPostRequest,
          context(request),
        ),
    );
  }

  app.get(
    "/admin/v1/community/reports",
    {
      schema: {
        operationId: adminOperation("listAdminCommunityReports"),
        tags: ["community"],
        response: responses,
      },
    },
    async (request) =>
      options.communityModerationService.listReports(context(request)),
  );

  app.post(
    "/admin/v1/community/users/:userId/hide",
    {
      schema: {
        operationId: "hideCommunityUser",
        tags: ["community"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.communityModerationService.setUserVisibility(
        (request.params as { userId: string }).userId,
        true,
        context(request),
      ),
  );

  app.post(
    "/admin/v1/community/users/:userId/unhide",
    {
      schema: {
        operationId: "unhideCommunityUser",
        tags: ["community"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.communityModerationService.setUserVisibility(
        (request.params as { userId: string }).userId,
        false,
        context(request),
      ),
  );

  app.post(
    "/admin/v1/community/reports/:reportId/resolve",
    {
      schema: {
        operationId: adminOperation("resolveCommunityReport"),
        tags: ["community"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.communityModerationService.resolveReport(
        (request.params as { reportId: string }).reportId,
        bodyRecord(request.body) as unknown as ResolveCommunityReportRequest,
        context(request),
      ),
  );
}
