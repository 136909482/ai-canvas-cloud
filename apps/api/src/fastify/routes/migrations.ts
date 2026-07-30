import type http from "node:http";
import { Type } from "@sinclair/typebox";
import {
  ApiErrorResponseSchema,
  CommitMigrationImportRequestSchema,
  CompleteMigrationImportAssetPartRequestSchema,
  CompleteMigrationImportAssetUploadRequestSchema,
  MigrationExportDownloadResponseSchema,
  MigrationExportResponseSchema,
  MigrationImportAssetUploadResponseSchema,
  MigrationImportCommitResponseSchema,
  MigrationImportResponseSchema,
  PrepareMigrationExportRequestSchema,
  PrepareMigrationImportRequestSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import type { AuthSessionResponse } from "@ai-canvas-cloud/contracts";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type {
  MigrationAssetUploadService,
  MigrationExportService,
  MigrationImportService,
} from "@ai-canvas-cloud/server/modules/migrations";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

interface MigrationRouteOptions {
  authContext: FastifyAuthContextAdapter;
  migrationAssetUploadService: MigrationAssetUploadService;
  migrationExportService: MigrationExportService;
  migrationImportService: MigrationImportService;
}

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

const EmptyQuerySchema = Type.Object({}, { additionalProperties: true });
const ImportParamsSchema = Type.Object(
  { importId: Type.String() },
  { additionalProperties: false },
);
const AssetParamsSchema = Type.Object(
  { importId: Type.String(), logicalAssetId: Type.String() },
  { additionalProperties: false },
);
const AssetPartParamsSchema = Type.Object(
  {
    importId: Type.String(),
    logicalAssetId: Type.String(),
    partNumber: Type.String(),
  },
  { additionalProperties: false },
);
const ExportParamsSchema = Type.Object(
  { projectId: Type.String(), exportId: Type.String() },
  { additionalProperties: false },
);
const ErrorResponses = {
  400: ApiErrorResponseSchema,
  401: ApiErrorResponseSchema,
  403: ApiErrorResponseSchema,
  404: ApiErrorResponseSchema,
  409: ApiErrorResponseSchema,
  413: ApiErrorResponseSchema,
  422: ApiErrorResponseSchema,
  429: ApiErrorResponseSchema,
  500: ApiErrorResponseSchema,
  503: ApiErrorResponseSchema,
};

function actor(session: AuthSessionResponse) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

async function requireImportSession(
  authContext: FastifyAuthContextAdapter,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await authContext.requireSession(request);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      await sendAuthError(reply, request.id, error);
      return;
    }
    throw error;
  }
}

function getExportSession(
  authContext: FastifyAuthContextAdapter,
  request: FastifyRequest,
) {
  return authContext
    .getService(request)
    .getSession(authContext.getContext(request));
}

async function requireExportSession(
  authContext: FastifyAuthContextAdapter,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await getExportSession(authContext, request);
  } catch (error) {
    await sendExportError(reply, request.id, error);
  }
}

function assertOptionalEmptyBody(request: FastifyRequest) {
  const hasBody =
    request.headers["transfer-encoding"] !== undefined ||
    Number(request.headers["content-length"] ?? 0) > 0;
  if (!hasBody) return;
  const body = request.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length > 0
  ) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Migration cancel body must be an empty object",
    });
  }
}

function partNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid migration import path",
    });
  }
  return parsed;
}

function sendExportError(
  reply: FastifyReply,
  requestId: string,
  error: unknown,
) {
  const serviceError =
    error instanceof AuthServiceError
      ? error
      : new AuthServiceError({
          statusCode: 500,
          apiCode: "SERVICE_UNAVAILABLE",
          message: "Migration export request failed",
        });
  return sendAuthError(reply, requestId, serviceError);
}

export function registerMigrationRoutes(
  app: PublicFastifyInstance,
  options: MigrationRouteOptions,
) {
  const importOnRequest = (request: FastifyRequest, reply: FastifyReply) =>
    requireImportSession(options.authContext, request, reply);
  const exportOnRequest = (request: FastifyRequest, reply: FastifyReply) =>
    requireExportSession(options.authContext, request, reply);

  app.post(
    "/api/v1/migrations/imports/prepare",
    {
      bodyLimit: 8 * 1024 * 1024,
      attachValidation: true,
      onRequest: importOnRequest,
      schema: {
        operationId: "prepareMigrationImport",
        tags: ["migrations"],
        body: PrepareMigrationImportRequestSchema,
        response: { 201: MigrationImportResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply
          .code(201)
          .send(
            await options.migrationImportService.prepareImport(
              request.body,
              actor(session),
            ),
          );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/migrations/imports/:importId",
    {
      onRequest: importOnRequest,
      schema: {
        operationId: "getMigrationImport",
        tags: ["migrations"],
        params: ImportParamsSchema,
        querystring: EmptyQuerySchema,
        response: { 200: MigrationImportResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.migrationImportService.getImport(
            request.params.importId,
            actor(session),
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/migrations/imports/:importId/cancel",
    {
      onRequest: importOnRequest,
      schema: {
        operationId: "cancelMigrationImport",
        tags: ["migrations"],
        params: ImportParamsSchema,
        response: { 200: MigrationImportResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        assertOptionalEmptyBody(request);
        return reply.send(
          await options.migrationImportService.cancelImport(
            request.params.importId,
            actor(session),
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/migrations/imports/:importId/commit",
    {
      bodyLimit: 64 * 1024,
      attachValidation: true,
      onRequest: importOnRequest,
      schema: {
        operationId: "commitMigrationImport",
        tags: ["migrations"],
        params: ImportParamsSchema,
        body: CommitMigrationImportRequestSchema,
        response: {
          200: MigrationImportCommitResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.migrationImportService.commitImport(
            request.params.importId,
            request.body,
            actor(session),
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.route({
    method: "POST",
    url: "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload",
    bodyLimit: 64 * 1024,
    onRequest: importOnRequest,
    schema: {
      operationId: "createMigrationAssetUpload",
      tags: ["migrations"],
      params: AssetParamsSchema,
      response: {
        201: MigrationImportAssetUploadResponseSchema,
        ...ErrorResponses,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        assertOptionalEmptyBody(request);
        return reply
          .code(201)
          .send(
            await options.migrationAssetUploadService.prepareAssetUpload(
              request.params.importId,
              request.params.logicalAssetId,
              actor(session),
            ),
          );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  });

  app.get(
    "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload",
    {
      onRequest: importOnRequest,
      schema: {
        operationId: "getMigrationAssetUpload",
        tags: ["migrations"],
        params: AssetParamsSchema,
        response: {
          200: MigrationImportAssetUploadResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.migrationAssetUploadService.getAssetUpload(
            request.params.importId,
            request.params.logicalAssetId,
            actor(session),
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/parts/:partNumber/complete",
    {
      bodyLimit: 32 * 1024,
      attachValidation: true,
      onRequest: importOnRequest,
      schema: {
        operationId: "completeMigrationAssetUploadPart",
        tags: ["migrations"],
        params: AssetPartParamsSchema,
        body: CompleteMigrationImportAssetPartRequestSchema,
        response: {
          200: MigrationImportAssetUploadResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.migrationAssetUploadService.completeAssetPart(
            request.params.importId,
            request.params.logicalAssetId,
            partNumber(request.params.partNumber),
            request.body,
            actor(session),
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/complete",
    {
      bodyLimit: 128 * 1024,
      attachValidation: true,
      onRequest: importOnRequest,
      schema: {
        operationId: "completeMigrationAssetUpload",
        tags: ["migrations"],
        params: AssetParamsSchema,
        body: Type.Optional(CompleteMigrationImportAssetUploadRequestSchema),
        response: {
          200: MigrationImportAssetUploadResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.migrationAssetUploadService.completeAssetUpload(
            request.params.importId,
            request.params.logicalAssetId,
            request.body,
            actor(session),
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/migrations/imports/:importId/assets/:logicalAssetId/cancel",
    {
      bodyLimit: 64 * 1024,
      onRequest: importOnRequest,
      schema: {
        operationId: "cancelMigrationAssetUpload",
        tags: ["migrations"],
        params: AssetParamsSchema,
        response: {
          200: MigrationImportAssetUploadResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        assertOptionalEmptyBody(request);
        return reply.send(
          await options.migrationAssetUploadService.cancelAssetUpload(
            request.params.importId,
            request.params.logicalAssetId,
            actor(session),
          ),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/projects/:projectId/exports/prepare",
    {
      bodyLimit: 64 * 1024,
      attachValidation: true,
      onRequest: exportOnRequest,
      schema: {
        operationId: "prepareMigrationExport",
        tags: ["migrations"],
        params: Type.Object(
          { projectId: Type.String() },
          { additionalProperties: false },
        ),
        body: PrepareMigrationExportRequestSchema,
        response: { 201: MigrationExportResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await getExportSession(options.authContext, request);
        return reply
          .code(201)
          .send(
            await options.migrationExportService.prepareExport(
              request.params.projectId,
              request.body,
              actor(session),
            ),
          );
      } catch (error) {
        return sendExportError(reply, request.id, error);
      }
    },
  );

  app.get(
    "/api/v1/projects/:projectId/exports/:exportId",
    {
      onRequest: exportOnRequest,
      schema: {
        operationId: "getMigrationExport",
        tags: ["migrations"],
        params: ExportParamsSchema,
        response: { 200: MigrationExportResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await getExportSession(options.authContext, request);
        return reply.send(
          await options.migrationExportService.getExport(
            request.params.projectId,
            request.params.exportId,
            actor(session),
          ),
        );
      } catch (error) {
        return sendExportError(reply, request.id, error);
      }
    },
  );

  app.get(
    "/api/v1/projects/:projectId/exports/:exportId/download",
    {
      onRequest: exportOnRequest,
      schema: {
        operationId: "downloadMigrationExport",
        tags: ["migrations"],
        params: ExportParamsSchema,
        response: {
          200: MigrationExportDownloadResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await getExportSession(options.authContext, request);
        return reply.send(
          await options.migrationExportService.downloadExport(
            request.params.projectId,
            request.params.exportId,
            actor(session),
          ),
        );
      } catch (error) {
        return sendExportError(reply, request.id, error);
      }
    },
  );

  for (const action of ["cancel", "retry"] as const) {
    app.post(
      `/api/v1/projects/:projectId/exports/:exportId/${action}`,
      {
        bodyLimit: 64 * 1024,
        onRequest: exportOnRequest,
        schema: {
          operationId:
            action === "cancel"
              ? "cancelMigrationExport"
              : "retryMigrationExport",
          tags: ["migrations"],
          params: ExportParamsSchema,
          response: { 200: MigrationExportResponseSchema, ...ErrorResponses },
        },
      },
      async (request, reply) => {
        try {
          const session = await getExportSession(options.authContext, request);
          assertOptionalEmptyBody(request);
          const serviceMethod =
            action === "cancel"
              ? options.migrationExportService.cancelExport
              : options.migrationExportService.retryExport;
          return reply.send(
            await serviceMethod(
              request.params.projectId,
              request.params.exportId,
              actor(session),
            ),
          );
        } catch (error) {
          return sendExportError(reply, request.id, error);
        }
      },
    );
  }
}
