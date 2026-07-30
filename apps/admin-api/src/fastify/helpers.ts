import type { FastifyRequest } from "fastify";
import {
  AdminAccessError,
  type AdminRequestContext,
} from "@ai-canvas-cloud/server/modules/admin";
import type { AdminApiConfig } from "../config.js";
import { getAdminClientIp } from "../security.js";

const operationIds = new Set<string>();

export function resetAdminOperationIds() {
  operationIds.clear();
}

export function adminOperation(operationId: string) {
  if (operationIds.has(operationId)) {
    throw new Error(`Duplicate Admin Fastify operationId: ${operationId}`);
  }
  operationIds.add(operationId);
  return operationId;
}

export function adminRequestContext(
  request: FastifyRequest,
  config: AdminApiConfig,
): AdminRequestContext {
  return {
    requestId: request.id,
    cookieHeader: request.raw.headers.cookie,
    ipAddress: getAdminClientIp(request.raw, config.trustProxy),
    userAgent: request.raw.headers["user-agent"],
  };
}

export function bodyRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "JSON body is invalid",
    );
  }
  return value as Record<string, unknown>;
}

export function stringField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "string") {
    throw new AdminAccessError(400, "VALIDATION_FAILED", `${key} is required`);
  }
  return value;
}

export function optionalStringField(
  body: Record<string, unknown>,
  key: string,
) {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      `${key} must be a string`,
    );
  }
  return value;
}

export function booleanField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "boolean") {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      `${key} must be a boolean`,
    );
  }
  return value;
}

export function queryDocument(request: FastifyRequest) {
  const url = new URL(request.raw.url ?? "/", "http://localhost");
  const output: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(output, key)) {
      throw new AdminAccessError(
        400,
        "VALIDATION_FAILED",
        `Duplicate query parameter: ${key}`,
      );
    }
    output[key] = value;
  }
  return output;
}
