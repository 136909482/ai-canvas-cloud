import type http from "node:http";
import {
  CreditBalanceSchema,
  CreditLedgerPageSchema,
  CreateOfficialImageTaskRequestSchema,
  OfficialGenerationPreferencesSchema,
  OfficialGenerationTaskPageSchema,
  OfficialGenerationTaskResponseSchema,
  OfficialModelsResponseSchema,
  RedeemCreditCodeRequestSchema,
  RedeemCreditCodeResponseSchema,
  UpdateOfficialGenerationPreferencesRequestSchema,
} from "@ai-canvas-cloud/contracts/official-generation-http-schema";
import { ApiErrorResponseSchema } from "@ai-canvas-cloud/contracts/http-schema";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { OfficialGenerationService } from "@ai-canvas-cloud/server/modules/official-generation";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

type PublicApp = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export function registerOfficialGenerationRoutes(
  app: PublicApp,
  options: {
    authContext: FastifyAuthContextAdapter;
    service: OfficialGenerationService;
  },
) {
  const actor = async (
    request: Parameters<typeof options.authContext.requireSession>[0],
  ) => {
    const session = await options.authContext.requireSession(request);
    return { userId: session.user.id, workspaceId: session.workspace.id };
  };
  const errors = {
    400: ApiErrorResponseSchema,
    401: ApiErrorResponseSchema,
    403: ApiErrorResponseSchema,
    404: ApiErrorResponseSchema,
    409: ApiErrorResponseSchema,
    429: ApiErrorResponseSchema,
    500: ApiErrorResponseSchema,
    503: ApiErrorResponseSchema,
  };
  const guarded = async (
    request: { id: string },
    reply: FastifyReply,
    operation: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      if (error instanceof AuthServiceError) {
        sendAuthError(reply, request.id, error);
        return;
      }
      throw error;
    }
  };

  app.get(
    "/api/v1/official-generation/preferences",
    {
      schema: {
        operationId: "getOfficialGenerationPreferences",
        tags: ["official-generation"],
        response: { 200: OfficialGenerationPreferencesSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () =>
        reply.send(await options.service.getPreferences(await actor(request))),
      ),
  );

  app.patch(
    "/api/v1/official-generation/preferences",
    {
      schema: {
        operationId: "updateOfficialGenerationPreferences",
        tags: ["official-generation"],
        body: UpdateOfficialGenerationPreferencesRequestSchema,
        response: { 200: OfficialGenerationPreferencesSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () =>
        reply.send(
          await options.service.updatePreferences(
            request.body,
            await actor(request),
          ),
        ),
      ),
  );

  app.get(
    "/api/v1/official-models",
    {
      schema: {
        operationId: "listOfficialModels",
        tags: ["official-generation"],
        response: { 200: OfficialModelsResponseSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () =>
        reply.send(await options.service.listModels(await actor(request))),
      ),
  );

  app.get(
    "/api/v1/credits",
    {
      schema: {
        operationId: "getCreditBalance",
        tags: ["credits"],
        response: { 200: CreditBalanceSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () =>
        reply.send(await options.service.getBalance(await actor(request))),
      ),
  );

  app.get(
    "/api/v1/credits/entries",
    {
      schema: {
        operationId: "listCreditEntries",
        tags: ["credits"],
        response: { 200: CreditLedgerPageSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () => {
        const cursor = new URL(
          request.raw.url ?? "/",
          "http://localhost",
        ).searchParams.get("cursor");
        return reply.send(
          await options.service.listLedger(await actor(request), cursor),
        );
      }),
  );

  app.post(
    "/api/v1/credits/redeem",
    {
      schema: {
        operationId: "redeemCreditCode",
        tags: ["credits"],
        body: RedeemCreditCodeRequestSchema,
        response: { 200: RedeemCreditCodeResponseSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () =>
        reply.send(
          await options.service.redeem(request.body, await actor(request)),
        ),
      ),
  );

  app.post(
    "/api/v1/official-image-tasks",
    {
      bodyLimit: 64 * 1024,
      schema: {
        operationId: "createOfficialImageTask",
        tags: ["official-generation"],
        body: CreateOfficialImageTaskRequestSchema,
        response: { 202: OfficialGenerationTaskResponseSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () =>
        reply
          .code(202)
          .send(
            await options.service.createTask(
              request.body,
              await actor(request),
            ),
          ),
      ),
  );

  app.get(
    "/api/v1/official-image-tasks",
    {
      schema: {
        operationId: "listOfficialImageTasks",
        tags: ["official-generation"],
        response: { 200: OfficialGenerationTaskPageSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () => {
        const cursor = new URL(
          request.raw.url ?? "/",
          "http://localhost",
        ).searchParams.get("cursor");
        return reply.send(
          await options.service.listTasks(await actor(request), cursor),
        );
      }),
  );

  app.get(
    "/api/v1/official-image-tasks/:taskId",
    {
      schema: {
        operationId: "getOfficialImageTask",
        tags: ["official-generation"],
        response: { 200: OfficialGenerationTaskResponseSchema, ...errors },
      },
    },
    (request, reply) =>
      guarded(request, reply, async () =>
        reply.send(
          await options.service.getTask(
            (request.params as { taskId: string }).taskId,
            await actor(request),
          ),
        ),
      ),
  );

  for (const action of ["cancel", "acknowledge"] as const) {
    app.post(
      `/api/v1/official-image-tasks/:taskId/${action}`,
      {
        schema: {
          operationId:
            action === "cancel"
              ? "cancelOfficialImageTask"
              : "acknowledgeOfficialImageTask",
          tags: ["official-generation"],
          response: { 200: OfficialGenerationTaskResponseSchema, ...errors },
        },
      },
      (request, reply) =>
        guarded(request, reply, async () => {
          const taskId = (request.params as { taskId: string }).taskId;
          const currentActor = await actor(request);
          return reply.send(
            action === "cancel"
              ? await options.service.cancelTask(taskId, currentActor)
              : await options.service.acknowledgeTask(taskId, currentActor),
          );
        }),
    );
  }
}
