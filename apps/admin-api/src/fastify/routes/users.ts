import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminPathIdSchema,
  AdminRequestBodySchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type { AdminUserOperationsService } from "@ai-canvas-cloud/server/modules/admin";
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
};

export function registerAdminUserRoutes(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    userOperationsService: AdminUserOperationsService;
  },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);

  app.get(
    "/admin/v1/users",
    {
      schema: {
        operationId: adminOperation("listAdminUsers"),
        tags: ["users"],
        response: responses,
      },
    },
    async (request) =>
      options.userOperationsService.listUsers(
        queryDocument(request),
        context(request),
      ),
  );

  app.get(
    "/admin/v1/users/:userId",
    {
      schema: {
        operationId: adminOperation("getAdminUser"),
        tags: ["users"],
        params: AdminPathIdSchema,
        response: responses,
      },
    },
    async (request) =>
      options.userOperationsService.getUser(
        request.params.userId,
        context(request),
      ),
  );

  app.get(
    "/admin/v1/users/:userId/deletion-preview",
    {
      schema: {
        operationId: adminOperation("getAdminUserDeletionPreview"),
        tags: ["users"],
        params: AdminPathIdSchema,
        response: responses,
      },
    },
    async (request) =>
      options.userOperationsService.getUserDeletionPreview(
        request.params.userId,
        context(request),
      ),
  );

  app.post(
    "/admin/v1/users/:userId/delete",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("deleteAdminUser"),
        tags: ["users"],
        params: AdminPathIdSchema,
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.userOperationsService.deleteUser(
        request.params.userId,
        bodyRecord(request.body),
        context(request),
      ),
  );

  const actions = [
    ["ban", "banAdminUser", "banUser"],
    ["unban", "unbanAdminUser", "unbanUser"],
    ["revoke-sessions", "revokeAdminUserSessions", "revokeUserSessions"],
    ["reset-password", "resetAdminUserPassword", "resetUserPassword"],
  ] as const;
  for (const [path, operationId, method] of actions) {
    app.post(
      `/admin/v1/users/:userId/${path}`,
      {
        bodyLimit: 16 * 1024,
        schema: {
          operationId: adminOperation(operationId),
          tags: ["users"],
          params: AdminPathIdSchema,
          body: AdminRequestBodySchema,
          response: responses,
        },
      },
      async (request) =>
        options.userOperationsService[method](
          request.params.userId,
          bodyRecord(request.body) as never,
          context(request),
        ),
    );
  }
}
