import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminRequestBodySchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type {
  AdminAssetCleanupService,
  AdminObjectStorageConfigService,
} from "@ai-canvas-cloud/server/modules/admin";
import type { AdminApiConfig } from "../../config.js";
import { adminOperation, adminRequestContext, bodyRecord } from "../helpers.js";
import type { AdminFastifyInstance } from "../types.js";

const responses = {
  200: AdminJsonObjectSchema,
  400: AdminErrorResponseSchema,
  401: AdminErrorResponseSchema,
  403: AdminErrorResponseSchema,
  409: AdminErrorResponseSchema,
  500: AdminErrorResponseSchema,
  503: AdminErrorResponseSchema,
};

export function registerAdminObjectStorageRoutes(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    objectStorageConfigService: AdminObjectStorageConfigService;
    assetCleanupService: AdminAssetCleanupService;
  },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);

  app.get(
    "/admin/v1/object-storage-settings",
    {
      schema: {
        operationId: adminOperation("getAdminObjectStorageSettings"),
        tags: ["object-storage"],
        response: responses,
      },
    },
    async (request) =>
      options.objectStorageConfigService.getCurrent(context(request)),
  );

  const actions = [
    [
      "/admin/v1/object-storage-settings/test-connection",
      "testAdminObjectStorageConnection",
      "testConnection",
    ],
    [
      "/admin/v1/object-storage-settings",
      "publishAdminObjectStorageSettings",
      "publish",
    ],
    [
      "/admin/v1/object-storage-settings/restore-environment",
      "restoreAdminObjectStorageEnvironment",
      "restoreEnvironment",
    ],
  ] as const;
  for (const [path, operationId, method] of actions) {
    app.post(
      path,
      {
        bodyLimit: 16 * 1024,
        schema: {
          operationId: adminOperation(operationId),
          tags: ["object-storage"],
          body: AdminRequestBodySchema,
          response: responses,
        },
      },
      async (request) =>
        options.objectStorageConfigService[method](
          bodyRecord(request.body) as never,
          context(request),
        ),
    );
  }

  app.post(
    "/admin/v1/asset-cleanup/preview",
    {
      schema: {
        operationId: adminOperation("previewAdminAssetCleanup"),
        tags: ["object-storage"],
        response: responses,
      },
    },
    async (request) => options.assetCleanupService.preview(context(request)),
  );

  app.post(
    "/admin/v1/asset-cleanup/apply",
    {
      schema: {
        operationId: adminOperation("applyAdminAssetCleanup"),
        tags: ["object-storage"],
        response: responses,
      },
    },
    async (request) => options.assetCleanupService.apply(context(request)),
  );
}
