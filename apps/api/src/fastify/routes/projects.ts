import type http from "node:http";
import { Type } from "@sinclair/typebox";
import {
  ApiErrorResponseSchema,
  ApplyProjectGraphOperationsRequestSchema,
  ApplyProjectGraphOperationsResponseSchema,
  CreateProjectCheckpointRequestSchema,
  CreateProjectRequestSchema,
  DeleteProjectResponseSchema,
  ProjectCheckpointResponseSchema,
  ProjectGraphChangesResponseSchema,
  ProjectGraphResponseSchema,
  ProjectResponseSchema,
  ProjectRevisionResponseSchema,
  ProjectRevisionRestoreResponseSchema,
  ProjectRevisionsResponseSchema,
  ProjectsResponseSchema,
  RenameProjectRequestSchema,
  RestoreProjectRevisionRequestSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import type {
  ApplyProjectGraphOperationsRequest,
  AuthSessionResponse,
  CreateProjectCheckpointRequest,
  CreateProjectRequest,
  ProjectListStatus,
  RenameProjectRequest,
  RestoreProjectRevisionRequest,
} from "@ai-canvas-cloud/contracts";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import {
  validateProjectGraphChangesAfter,
  type ProjectGraphService,
} from "@ai-canvas-cloud/server/modules/project-graph";
import type { ProjectSnapshotService } from "@ai-canvas-cloud/server/modules/project-snapshots";
import type { ProjectService } from "@ai-canvas-cloud/server/modules/projects";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

interface ProjectRouteOptions {
  authContext: FastifyAuthContextAdapter;
  projectGraphService: ProjectGraphService;
  projectSnapshotService: ProjectSnapshotService;
  projectService: ProjectService;
}

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

const EmptyQuerySchema = Type.Object({}, { additionalProperties: true });
const ProjectParamsSchema = Type.Object(
  { projectId: Type.String() },
  { additionalProperties: false },
);
const RevisionParamsSchema = Type.Object(
  { projectId: Type.String(), version: Type.String() },
  { additionalProperties: false },
);
const ProjectListQuerySchema = Type.Object(
  {
    status: Type.Optional(Type.String()),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const ProjectChangesQuerySchema = Type.Object(
  { after: Type.Optional(Type.String()) },
  { additionalProperties: true },
);
const ProjectRevisionsQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const ErrorResponses = {
  400: ApiErrorResponseSchema,
  401: ApiErrorResponseSchema,
  403: ApiErrorResponseSchema,
  404: ApiErrorResponseSchema,
  409: ApiErrorResponseSchema,
  413: ApiErrorResponseSchema,
  429: ApiErrorResponseSchema,
  500: ApiErrorResponseSchema,
  503: ApiErrorResponseSchema,
};

function actor(session: AuthSessionResponse) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

function queryValue(request: FastifyRequest, name: string) {
  return new URL(request.raw.url ?? "/", "http://localhost").searchParams.get(
    name,
  );
}

async function requireSession(
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

async function respond(
  options: ProjectRouteOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  action: (projectActor: ReturnType<typeof actor>) => Promise<unknown>,
) {
  try {
    const session = await options.authContext.requireSession(request);
    return reply.code(statusCode).send(await action(actor(session)));
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return sendAuthError(reply, request.id, error);
    }
    throw error;
  }
}

export function registerProjectRoutes(
  app: PublicFastifyInstance,
  options: ProjectRouteOptions,
) {
  const onRequest = (request: FastifyRequest, reply: FastifyReply) =>
    requireSession(options.authContext, request, reply);

  app.get(
    "/api/v1/projects",
    {
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "listProjects",
        tags: ["projects"],
        querystring: ProjectListQuerySchema,
        response: { 200: ProjectsResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) => {
        const status = queryValue(request, "status");
        const limit = queryValue(request, "limit");
        return options.projectService.listProjects(
          {
            status: status === null ? undefined : (status as ProjectListStatus),
            cursor: queryValue(request, "cursor"),
            limit: limit === null ? undefined : Number(limit),
          },
          projectActor,
        );
      }),
  );

  app.post(
    "/api/v1/projects",
    {
      bodyLimit: 64 * 1024,
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "createProject",
        tags: ["projects"],
        body: CreateProjectRequestSchema,
        response: { 201: ProjectResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 201, (projectActor) =>
        options.projectService.createProject(
          request.body as CreateProjectRequest,
          projectActor,
        ),
      ),
  );

  app.get(
    "/api/v1/projects/:projectId",
    {
      onRequest,
      schema: {
        operationId: "getProject",
        tags: ["projects"],
        params: ProjectParamsSchema,
        querystring: EmptyQuerySchema,
        response: { 200: ProjectResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectService.getProject(
          request.params.projectId,
          projectActor,
        ),
      ),
  );

  app.patch(
    "/api/v1/projects/:projectId",
    {
      bodyLimit: 64 * 1024,
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "updateProject",
        tags: ["projects"],
        params: ProjectParamsSchema,
        body: RenameProjectRequestSchema,
        response: { 200: ProjectResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectService.renameProject(
          request.params.projectId,
          request.body as RenameProjectRequest,
          projectActor,
        ),
      ),
  );

  app.post(
    "/api/v1/projects/:projectId/archive",
    {
      onRequest,
      schema: {
        operationId: "archiveProject",
        tags: ["projects"],
        params: ProjectParamsSchema,
        response: { 200: ProjectResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectService.archiveProject(
          request.params.projectId,
          projectActor,
        ),
      ),
  );

  app.post(
    "/api/v1/projects/:projectId/restore",
    {
      onRequest,
      schema: {
        operationId: "restoreProject",
        tags: ["projects"],
        params: ProjectParamsSchema,
        response: { 200: ProjectResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectService.restoreProject(
          request.params.projectId,
          projectActor,
        ),
      ),
  );

  app.delete(
    "/api/v1/projects/:projectId",
    {
      onRequest,
      schema: {
        operationId: "deleteProject",
        tags: ["projects"],
        params: ProjectParamsSchema,
        response: { 200: DeleteProjectResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectService.deleteProject(
          request.params.projectId,
          projectActor,
        ),
      ),
  );

  app.get(
    "/api/v1/projects/:projectId/graph",
    {
      onRequest,
      schema: {
        operationId: "getProjectGraph",
        tags: ["projects"],
        params: ProjectParamsSchema,
        querystring: EmptyQuerySchema,
        response: { 200: ProjectGraphResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectGraphService.getGraph(
          request.params.projectId,
          projectActor,
        ),
      ),
  );

  app.patch(
    "/api/v1/projects/:projectId/graph",
    {
      bodyLimit: 2 * 1024 * 1024,
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "applyProjectGraphOperations",
        tags: ["projects"],
        params: ProjectParamsSchema,
        body: ApplyProjectGraphOperationsRequestSchema,
        response: {
          200: ApplyProjectGraphOperationsResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectGraphService.applyOperations(
          request.params.projectId,
          request.body as ApplyProjectGraphOperationsRequest,
          projectActor,
        ),
      ),
  );

  app.get(
    "/api/v1/projects/:projectId/changes",
    {
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "getProjectChanges",
        tags: ["projects"],
        params: ProjectParamsSchema,
        querystring: ProjectChangesQuerySchema,
        response: {
          200: ProjectGraphChangesResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectGraphService.getChanges(
          request.params.projectId,
          validateProjectGraphChangesAfter(queryValue(request, "after")),
          projectActor,
        ),
      ),
  );

  app.post(
    "/api/v1/projects/:projectId/checkpoints",
    {
      bodyLimit: 64 * 1024,
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "createProjectCheckpoint",
        tags: ["projects"],
        params: ProjectParamsSchema,
        body: CreateProjectCheckpointRequestSchema,
        response: { 201: ProjectCheckpointResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 201, (projectActor) =>
        options.projectSnapshotService.createCheckpoint(
          request.params.projectId,
          request.body as CreateProjectCheckpointRequest,
          projectActor,
        ),
      ),
  );

  app.get(
    "/api/v1/projects/:projectId/revisions",
    {
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "listProjectRevisions",
        tags: ["projects"],
        params: ProjectParamsSchema,
        querystring: ProjectRevisionsQuerySchema,
        response: { 200: ProjectRevisionsResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) => {
        const limit = queryValue(request, "limit");
        return options.projectSnapshotService.listRevisions(
          request.params.projectId,
          {
            cursor: queryValue(request, "cursor"),
            limit: limit === null ? undefined : Number(limit),
          },
          projectActor,
        );
      }),
  );

  app.get(
    "/api/v1/projects/:projectId/revisions/:version",
    {
      onRequest,
      schema: {
        operationId: "getProjectRevision",
        tags: ["projects"],
        params: RevisionParamsSchema,
        querystring: EmptyQuerySchema,
        response: { 200: ProjectRevisionResponseSchema, ...ErrorResponses },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectSnapshotService.getRevision(
          request.params.projectId,
          Number(request.params.version),
          projectActor,
        ),
      ),
  );

  app.post(
    "/api/v1/projects/:projectId/revisions/:version/restore",
    {
      bodyLimit: 64 * 1024,
      attachValidation: true,
      onRequest,
      schema: {
        operationId: "restoreProjectRevision",
        tags: ["projects"],
        params: RevisionParamsSchema,
        body: RestoreProjectRevisionRequestSchema,
        response: {
          200: ProjectRevisionRestoreResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    (request, reply) =>
      respond(options, request, reply, 200, (projectActor) =>
        options.projectSnapshotService.restoreRevision(
          request.params.projectId,
          Number(request.params.version),
          request.body as RestoreProjectRevisionRequest,
          projectActor,
        ),
      ),
  );
}
