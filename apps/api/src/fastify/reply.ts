import type { AuthServiceError } from "@ai-canvas-cloud/server/modules/auth";
import type { FastifyReply } from "fastify";

export function sendAuthError(
  reply: FastifyReply,
  requestId: string,
  error: AuthServiceError,
) {
  return reply.code(error.statusCode).send({
    error: {
      code: error.apiCode,
      message: error.message,
      retryable: error.retryable,
      requestId,
      details: error.details,
    },
  });
}

export function setCookieHeaders(reply: FastifyReply, headers: string[]) {
  if (headers.length > 0) {
    reply.header("set-cookie", headers);
  }
}
