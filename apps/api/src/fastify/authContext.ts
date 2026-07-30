import type http from "node:http";
import {
  AuthServiceError,
  type AuthService,
} from "@ai-canvas-cloud/server/modules/auth";
import {
  createRequestAuthService,
  getAuthContext,
  getTrustedRateLimitScopes,
} from "../requestContext.js";

interface FastifyRequestIdentity {
  id: string;
  raw: http.IncomingMessage;
}

export function createFastifyAuthContextAdapter(authService: AuthService) {
  const requestServices = new WeakMap<http.IncomingMessage, AuthService>();

  function getRequestService(request: FastifyRequestIdentity) {
    let service = requestServices.get(request.raw);
    if (!service) {
      service = createRequestAuthService(authService, request.id);
      requestServices.set(request.raw, service);
    }
    return service;
  }

  function requireCookie(request: FastifyRequestIdentity) {
    const context = getAuthContext(request.raw, request.id);
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }
    return context;
  }

  return {
    getContext(request: FastifyRequestIdentity) {
      return getAuthContext(request.raw, request.id);
    },
    getService(request: FastifyRequestIdentity) {
      return getRequestService(request);
    },
    requireCookie,
    async requireSession(request: FastifyRequestIdentity) {
      const context = requireCookie(request);
      return getRequestService(request).getSession(context);
    },
    getTrustedRateLimitScopes(request: FastifyRequestIdentity) {
      return getTrustedRateLimitScopes(
        request.raw,
        request.id,
        getRequestService(request),
      );
    },
  };
}

export type FastifyAuthContextAdapter = ReturnType<
  typeof createFastifyAuthContextAdapter
>;
