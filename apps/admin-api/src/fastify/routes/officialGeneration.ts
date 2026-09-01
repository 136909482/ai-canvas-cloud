import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminRequestBodySchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import { Type } from "@sinclair/typebox";
import type {
  AdminCreateOfficialProviderRequest,
  AdminCreateRedemptionBatchRequest,
  AdminCreditAdjustmentRequest,
  AdminUpdateCreditSettingsRequest,
  AdminUpsertOfficialModelRequest,
} from "@ai-canvas-cloud/contracts";
import type { AdminOfficialGenerationService } from "@ai-canvas-cloud/server/modules/admin";
import type { AdminApiConfig } from "../../config.js";
import { adminOperation, adminRequestContext, bodyRecord } from "../helpers.js";
import type { AdminFastifyInstance } from "../types.js";

const responses = {
  200: AdminJsonObjectSchema,
  201: AdminJsonObjectSchema,
  400: AdminErrorResponseSchema,
  401: AdminErrorResponseSchema,
  403: AdminErrorResponseSchema,
  404: AdminErrorResponseSchema,
  409: AdminErrorResponseSchema,
  500: AdminErrorResponseSchema,
};
const PathIdSchema = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);

export function registerAdminOfficialGenerationRoutes(
  app: AdminFastifyInstance,
  options: { config: AdminApiConfig; service: AdminOfficialGenerationService },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);
  const get = [
    [
      "/admin/v1/official-providers",
      "listAdminOfficialProviders",
      "listProviders",
    ],
    ["/admin/v1/official-models", "listAdminOfficialModels", "listModels"],
    [
      "/admin/v1/credit-settings",
      "getAdminCreditSettings",
      "getCreditSettings",
    ],
    [
      "/admin/v1/redemption-code-batches",
      "listAdminRedemptionBatches",
      "listRedemptionBatches",
    ],
  ] as const;
  for (const [path, operationId, method] of get) {
    app.get(
      path,
      {
        schema: {
          operationId: adminOperation(operationId),
          tags: ["official-generation"],
          response: responses,
        },
      },
      async (request) => options.service[method](context(request)),
    );
  }

  app.post(
    "/admin/v1/official-providers",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("createAdminOfficialProvider"),
        tags: ["official-generation"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await options.service.createProvider(
            bodyRecord(
              request.body,
            ) as unknown as AdminCreateOfficialProviderRequest,
            context(request),
          ),
        ),
  );
  app.get(
    "/admin/v1/official-providers/:id/models",
    {
      schema: {
        operationId: adminOperation("listAdminOfficialProviderModels"),
        tags: ["official-generation"],
        params: PathIdSchema,
        response: responses,
      },
    },
    async (request) =>
      options.service.listProviderModels(request.params.id, context(request)),
  );
  app.post(
    "/admin/v1/official-providers/:id/test",
    {
      schema: {
        operationId: adminOperation("testAdminOfficialProvider"),
        tags: ["official-generation"],
        params: PathIdSchema,
        response: responses,
      },
    },
    async (request) =>
      options.service.testProvider(request.params.id, context(request)),
  );

  app.post(
    "/admin/v1/official-models",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("createAdminOfficialModel"),
        tags: ["official-generation"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await options.service.createModel(
            bodyRecord(
              request.body,
            ) as unknown as AdminUpsertOfficialModelRequest,
            context(request),
          ),
        ),
  );
  app.post(
    "/admin/v1/official-models/:id",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("updateAdminOfficialModel"),
        tags: ["official-generation"],
        params: PathIdSchema,
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.service.updateModel(
        request.params.id,
        bodyRecord(request.body) as unknown as AdminUpsertOfficialModelRequest,
        context(request),
      ),
  );

  app.post(
    "/admin/v1/credit-settings",
    {
      schema: {
        operationId: adminOperation("updateAdminCreditSettings"),
        tags: ["official-generation"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.service.updateCreditSettings(
        bodyRecord(request.body) as unknown as AdminUpdateCreditSettingsRequest,
        context(request),
      ),
  );
  app.post(
    "/admin/v1/redemption-code-batches",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("createAdminRedemptionBatch"),
        tags: ["official-generation"],
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await options.service.createRedemptionBatch(
            bodyRecord(
              request.body,
            ) as unknown as AdminCreateRedemptionBatchRequest,
            context(request),
          ),
        ),
  );
  app.post(
    "/admin/v1/redemption-code-batches/:id/revoke",
    {
      schema: {
        operationId: adminOperation("revokeAdminRedemptionBatch"),
        tags: ["official-generation"],
        params: PathIdSchema,
        response: responses,
      },
    },
    async (request) =>
      options.service.revokeRedemptionBatch(
        request.params.id,
        context(request),
      ),
  );

  app.get(
    "/admin/v1/users/:id/credits",
    {
      schema: {
        operationId: adminOperation("getAdminUserCredits"),
        tags: ["official-generation"],
        params: PathIdSchema,
        response: responses,
      },
    },
    async (request) =>
      options.service.getUserCredits(request.params.id, context(request)),
  );
  app.post(
    "/admin/v1/users/:id/credits/adjust",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("adjustAdminUserCredits"),
        tags: ["official-generation"],
        params: PathIdSchema,
        body: AdminRequestBodySchema,
        response: responses,
      },
    },
    async (request) =>
      options.service.adjustUserCredits(
        request.params.id,
        bodyRecord(request.body) as unknown as AdminCreditAdjustmentRequest,
        context(request),
      ),
  );
}
