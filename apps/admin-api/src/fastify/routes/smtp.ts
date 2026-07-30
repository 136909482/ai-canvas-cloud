import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminRequestBodySchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type { AdminSmtpConfigService } from "@ai-canvas-cloud/server/modules/admin";
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

export function registerAdminSmtpRoutes(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    smtpConfigService: AdminSmtpConfigService;
  },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);

  app.get(
    "/admin/v1/smtp-settings",
    {
      schema: {
        operationId: adminOperation("getAdminSmtpSettings"),
        tags: ["smtp"],
        response: responses,
      },
    },
    async (request) => options.smtpConfigService.getCurrent(context(request)),
  );

  const actions = [
    [
      "/admin/v1/smtp-settings/test-connection",
      "testAdminSmtpConnection",
      "testConnection",
    ],
    ["/admin/v1/smtp-settings/test-email", "testAdminSmtpEmail", "testEmail"],
    ["/admin/v1/smtp-settings", "publishAdminSmtpSettings", "publish"],
    ["/admin/v1/smtp-settings/disable", "disableAdminSmtpSettings", "disable"],
  ] as const;
  for (const [path, operationId, method] of actions) {
    app.post(
      path,
      {
        bodyLimit: 16 * 1024,
        schema: {
          operationId: adminOperation(operationId),
          tags: ["smtp"],
          body: AdminRequestBodySchema,
          response: responses,
        },
      },
      async (request) =>
        options.smtpConfigService[method](
          bodyRecord(request.body) as never,
          context(request),
        ),
    );
  }
}
