import type http from "node:http";
import { Type } from "@sinclair/typebox";
import {
  ApiErrorResponseSchema,
  AuthDevicesResponseSchema,
  AuthSessionResponseSchema,
  AuthSessionsResponseSchema,
  AuthSuccessResponseSchema,
  LoginRequestSchema,
  LogoutResponseSchema,
  PasswordChangeRequestSchema,
  PasswordChangeResponseSchema,
  PasswordForgotRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetResponseSchema,
  RegisterRequestSchema,
  RegistrationEmailCodeRequestSchema,
  RegistrationEmailCodeResponseSchema,
  RemoveDeviceResponseSchema,
  RevokeSessionResponseSchema,
} from "@ai-canvas-cloud/contracts/http-schema";
import { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { FastifyAuthContextAdapter } from "../authContext.js";
import { sendAuthError, setCookieHeaders } from "../reply.js";

type PublicFastifyInstance = FastifyInstance<
  http.Server,
  http.IncomingMessage,
  http.ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

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
const AUTH_BODY_LIMIT = 64 * 1024;

function protectedOnRequest(authContext: FastifyAuthContextAdapter) {
  return async (
    request: Parameters<FastifyAuthContextAdapter["requireCookie"]>[0],
    reply: Parameters<typeof sendAuthError>[0],
  ) => {
    try {
      authContext.requireCookie(request);
    } catch (error) {
      if (error instanceof AuthServiceError) {
        await sendAuthError(reply, request.id, error);
        return;
      }
      throw error;
    }
  };
}

export function registerAuthRoutes(
  app: PublicFastifyInstance,
  authContext: FastifyAuthContextAdapter,
) {
  const requireCookie = protectedOnRequest(authContext);

  app.post(
    "/api/v1/auth/register",
    {
      bodyLimit: AUTH_BODY_LIMIT,
      attachValidation: true,
      schema: {
        operationId: "registerUser",
        tags: ["auth"],
        body: RegisterRequestSchema,
        response: { 201: AuthSuccessResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const result = await authContext
          .getService(request)
          .register(request.body, authContext.getContext(request));
        setCookieHeaders(reply, result.setCookieHeaders);
        return reply.code(201).send(result.response);
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/auth/login",
    {
      bodyLimit: AUTH_BODY_LIMIT,
      attachValidation: true,
      schema: {
        operationId: "loginUser",
        tags: ["auth"],
        body: LoginRequestSchema,
        response: { 200: AuthSuccessResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const result = await authContext
          .getService(request)
          .login(request.body, authContext.getContext(request));
        setCookieHeaders(reply, result.setCookieHeaders);
        return reply.send(result.response);
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/auth/session",
    {
      onRequest: requireCookie,
      schema: {
        operationId: "getAuthSession",
        tags: ["auth"],
        response: { 200: AuthSessionResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(await authContext.requireSession(request));
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/auth/logout",
    {
      onRequest: async (request, reply) => {
        try {
          const context = authContext.getContext(request);
          if (context.cookieHeader) {
            const result = await authContext
              .getService(request)
              .logout(context);
            setCookieHeaders(reply, result.setCookieHeaders);
          }
          await reply.send({ ok: true });
        } catch (error) {
          if (error instanceof AuthServiceError) {
            await sendAuthError(reply, request.id, error);
            return;
          }
          throw error;
        }
      },
      schema: {
        operationId: "logoutUser",
        tags: ["auth"],
        response: { 200: LogoutResponseSchema, ...ErrorResponses },
      },
    },
    async (_request, reply) => reply.send({ ok: true }),
  );

  app.get(
    "/api/v1/auth/sessions",
    {
      onRequest: requireCookie,
      schema: {
        operationId: "listAuthSessions",
        tags: ["auth"],
        response: { 200: AuthSessionsResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          await authContext
            .getService(request)
            .listSessions(authContext.requireCookie(request)),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/auth/devices",
    {
      onRequest: requireCookie,
      schema: {
        operationId: "listAuthDevices",
        tags: ["auth"],
        response: { 200: AuthDevicesResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          await authContext
            .getService(request)
            .listDevices(authContext.requireCookie(request)),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/auth/registration/email-code",
    {
      bodyLimit: AUTH_BODY_LIMIT,
      attachValidation: true,
      schema: {
        operationId: "requestRegistrationEmailCode",
        tags: ["auth"],
        body: RegistrationEmailCodeRequestSchema,
        response: {
          200: RegistrationEmailCodeResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          await authContext
            .getService(request)
            .sendRegistrationEmailCode(
              request.body,
              authContext.getContext(request),
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
    "/api/v1/auth/password/forgot",
    {
      bodyLimit: AUTH_BODY_LIMIT,
      attachValidation: true,
      schema: {
        operationId: "requestPasswordResetEmailCode",
        tags: ["auth"],
        body: PasswordForgotRequestSchema,
        response: { 200: PasswordResetResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          await authContext
            .getService(request)
            .requestPasswordReset(
              request.body,
              authContext.getContext(request),
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
    "/api/v1/auth/password/reset",
    {
      bodyLimit: AUTH_BODY_LIMIT,
      attachValidation: true,
      schema: {
        operationId: "resetPassword",
        tags: ["auth"],
        body: PasswordResetRequestSchema,
        response: { 200: PasswordResetResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          await authContext
            .getService(request)
            .resetPassword(request.body, authContext.getContext(request)),
        );
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/auth/password/change",
    {
      bodyLimit: AUTH_BODY_LIMIT,
      attachValidation: true,
      onRequest: requireCookie,
      schema: {
        operationId: "changePassword",
        tags: ["auth"],
        body: PasswordChangeRequestSchema,
        response: { 200: PasswordChangeResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const result = await authContext
          .getService(request)
          .changePassword(request.body, authContext.requireCookie(request));
        setCookieHeaders(reply, result.setCookieHeaders);
        return reply.send(result.response);
      } catch (error) {
        if (error instanceof AuthServiceError)
          return sendAuthError(reply, request.id, error);
        throw error;
      }
    },
  );

  app.delete(
    "/api/v1/auth/sessions/:sessionId",
    {
      onRequest: async (request, reply) => {
        try {
          const result = await authContext
            .getService(request)
            .revokeSession(
              request.params.sessionId,
              authContext.requireCookie(request),
            );
          setCookieHeaders(reply, result.setCookieHeaders);
          await reply.send(result.response);
        } catch (error) {
          if (error instanceof AuthServiceError) {
            await sendAuthError(reply, request.id, error);
            return;
          }
          throw error;
        }
      },
      schema: {
        operationId: "deleteAuthSession",
        tags: ["auth"],
        params: Type.Object(
          { sessionId: Type.String() },
          { additionalProperties: false },
        ),
        response: { 200: RevokeSessionResponseSchema, ...ErrorResponses },
      },
    },
    async (_request, reply) => reply.send({ ok: true }),
  );

  app.delete(
    "/api/v1/auth/devices/:deviceId",
    {
      onRequest: async (request, reply) => {
        try {
          await reply.send(
            await authContext
              .getService(request)
              .removeDevice(
                request.params.deviceId,
                authContext.requireCookie(request),
              ),
          );
        } catch (error) {
          if (error instanceof AuthServiceError) {
            await sendAuthError(reply, request.id, error);
            return;
          }
          throw error;
        }
      },
      schema: {
        operationId: "deleteAuthDevice",
        tags: ["auth"],
        params: Type.Object(
          { deviceId: Type.String() },
          { additionalProperties: false },
        ),
        response: { 200: RemoveDeviceResponseSchema, ...ErrorResponses },
      },
    },
    async (_request, reply) => reply.send({ ok: true }),
  );
}
