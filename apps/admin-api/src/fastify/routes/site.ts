import type {
  CreateSiteAssetRequest,
  PublishSiteConfigRequest,
} from "@ai-canvas-cloud/contracts";
import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminRequestBodySchema,
  AdminSiteAssetPathSchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type { AdminSiteConfigService } from "@ai-canvas-cloud/server/modules/admin";
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

export function registerAdminSiteRoutes(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    siteConfigService: AdminSiteConfigService;
  },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);

  app.get(
    "/admin/v1/site-config",
    {
      schema: {
        operationId: adminOperation("getAdminSiteConfig"),
        tags: ["site"],
        response: responses,
      },
    },
    async (request) => options.siteConfigService.getCurrent(context(request)),
  );

  app.post(
    "/admin/v1/site-config",
    {
      bodyLimit: 32 * 1024,
      schema: {
        operationId: adminOperation("publishAdminSiteConfig"),
        tags: ["site"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.siteConfigService.publish(
        bodyRecord(request.body) as unknown as PublishSiteConfigRequest,
        context(request),
      ),
  );

  app.get(
    "/admin/v1/site-assets",
    {
      schema: {
        operationId: adminOperation("listAdminSiteAssets"),
        tags: ["site"],
        response: responses,
      },
    },
    async (request) => options.siteConfigService.listAssets(context(request)),
  );

  app.post(
    "/admin/v1/site-assets",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("createAdminSiteAsset"),
        tags: ["site"],
        body: AdminRequestBodySchema,
        response: { ...responses, 201: AdminJsonObjectSchema },
      },
    },
    async (request, reply) => {
      const payload = await options.siteConfigService.createAsset(
        bodyRecord(request.body) as unknown as CreateSiteAssetRequest,
        context(request),
      );
      return reply.code(201).send(payload);
    },
  );

  app.post(
    "/admin/v1/site-assets/:assetId/complete",
    {
      schema: {
        operationId: adminOperation("completeAdminSiteAsset"),
        tags: ["site"],
        params: AdminSiteAssetPathSchema,
        response: responses,
      },
    },
    async (request) =>
      options.siteConfigService.completeAsset(
        request.params.assetId,
        context(request),
      ),
  );
}
