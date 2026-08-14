import type http from "node:http";
import type {
  CreateCommunityPostRequest,
  CreateCommunityReportRequest,
  UpdateCommunityPostRequest,
  UpdateCommunityProfileRequest,
} from "@ai-canvas-cloud/contracts";
import {
  ApiErrorResponseSchema,
  CommunityPostResponseSchema,
  CommunityProfileResponseSchema,
  CommunityReportResponseSchema,
  CommunityPublicPostsResponseSchema,
  CommunityPublicPostResponseSchema,
  CreateCommunityPostRequestSchema,
  CreateCommunityReportRequestSchema,
  MyCommunityPostsResponseSchema,
  UpdateCommunityPostRequestSchema,
  UpdateCommunityProfileRequestSchema,
  WithdrawCommunityPostResponseSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { AssetService } from "@ai-canvas-cloud/server/modules/assets";
import type {
  CommunityContentService,
  CommunityProfileService,
} from "@ai-canvas-cloud/server/modules/community";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError } from "../reply.js";

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

const errorResponses = {
  400: ApiErrorResponseSchema,
  401: ApiErrorResponseSchema,
  403: ApiErrorResponseSchema,
  409: ApiErrorResponseSchema,
  429: ApiErrorResponseSchema,
  500: ApiErrorResponseSchema,
  503: ApiErrorResponseSchema,
};

export function registerCommunityRoutes(
  app: PublicFastifyInstance,
  options: {
    authContext: FastifyAuthContextAdapter;
    communityProfileService: CommunityProfileService;
    communityContentService: CommunityContentService;
    assetService: AssetService;
  },
) {
  app.get(
    "/api/v1/community/posts",
    {
      schema: {
        operationId: "listCommunityPosts",
        tags: ["community"],
        response: {
          200: CommunityPublicPostsResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        await options.authContext.requireSession(request);
        const query = new URL(request.raw.url ?? "/", "http://localhost")
          .searchParams;
        const page = await options.communityContentService.listPublic({
          query: query.get("q"),
          tag: query.get("tag"),
          cursor: query.get("cursor"),
        });
        const items = await Promise.all(
          page.items.map(async (post) => {
            const image = await options.assetService.getCommunityAssetUrl(
              post.assetId,
            );
            return {
              id: post.id,
              imageUrl: image.url,
              imageExpiresAt: image.expiresAt,
              title: post.title,
              tags: post.tags,
              publishedAt: post.publishedAt,
              publicNickname: post.publicNickname,
            };
          }),
        );
        return reply.send({ items, nextCursor: page.nextCursor });
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/community/posts/:postId",
    {
      schema: {
        operationId: "getCommunityPost",
        tags: ["community"],
        response: { 200: CommunityPublicPostResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      try {
        await options.authContext.requireSession(request);
        const result = await options.communityContentService.getPublic(
          (request.params as { postId: string }).postId,
        );
        const image = await options.assetService.getCommunityAssetUrl(
          result.post.assetId,
        );
        return reply.send({
          post: {
            id: result.post.id,
            imageUrl: image.url,
            imageExpiresAt: image.expiresAt,
            title: result.post.title,
            tags: result.post.tags,
            publishedAt: result.post.publishedAt,
            publicNickname: result.post.publicNickname,
          },
        });
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/community/profile",
    {
      schema: {
        operationId: "getCommunityProfile",
        tags: ["community"],
        response: {
          200: CommunityProfileResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.communityProfileService.get(session.user.id),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.patch(
    "/api/v1/community/profile",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: "updateCommunityProfile",
        tags: ["community"],
        body: UpdateCommunityProfileRequestSchema,
        response: {
          200: CommunityProfileResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.communityProfileService.update(
            request.body as UpdateCommunityProfileRequest,
            session.user.id,
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
    "/api/v1/community/me/posts",
    {
      schema: {
        operationId: "listMyCommunityPosts",
        tags: ["community"],
        response: { 200: MyCommunityPostsResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        const cursor = new URL(
          request.raw.url ?? "/",
          "http://localhost",
        ).searchParams.get("cursor");
        return reply.send(
          await options.communityContentService.listMine(
            { userId: session.user.id, workspaceId: session.workspace.id },
            cursor,
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
    "/api/v1/community/posts",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: "createCommunityPost",
        tags: ["community"],
        body: CreateCommunityPostRequestSchema,
        response: { 201: CommunityPostResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply
          .code(201)
          .send(
            await options.communityContentService.create(
              request.body as CreateCommunityPostRequest,
              { userId: session.user.id, workspaceId: session.workspace.id },
            ),
          );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.patch(
    "/api/v1/community/posts/:postId",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: "updateCommunityPost",
        tags: ["community"],
        body: UpdateCommunityPostRequestSchema,
        response: { 200: CommunityPostResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.communityContentService.update(
            (request.params as { postId: string }).postId,
            request.body as UpdateCommunityPostRequest,
            { userId: session.user.id, workspaceId: session.workspace.id },
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
    "/api/v1/community/posts/:postId/withdraw",
    {
      schema: {
        operationId: "withdrawCommunityPost",
        tags: ["community"],
        response: {
          200: WithdrawCommunityPostResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply.send(
          await options.communityContentService.withdraw(
            (request.params as { postId: string }).postId,
            { userId: session.user.id, workspaceId: session.workspace.id },
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
    "/api/v1/community/posts/:postId/report",
    {
      bodyLimit: 8 * 1024,
      schema: {
        operationId: "reportCommunityPost",
        tags: ["community"],
        body: CreateCommunityReportRequestSchema,
        response: { 201: CommunityReportResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      try {
        const session = await options.authContext.requireSession(request);
        return reply
          .code(201)
          .send(
            await options.communityContentService.report(
              (request.params as { postId: string }).postId,
              request.body as CreateCommunityReportRequest,
              { userId: session.user.id, workspaceId: session.workspace.id },
            ),
          );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );
}
