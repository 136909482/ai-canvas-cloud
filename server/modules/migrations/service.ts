import type {
  MigrationImportCommitResponse,
  MigrationImportResponse,
} from "@ai-canvas-cloud/contracts";
import { AuthServiceError } from "../auth/service.js";
import type { ProjectActor } from "../projects/service.js";

export const MIGRATION_IMPORT_TTL_HOURS = 24;
export const MIGRATION_IMPORT_WRITE_ROLES = [
  "owner",
  "admin",
  "editor",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MigrationImportService {
  prepareImport: (
    input: unknown,
    actor: ProjectActor,
  ) => Promise<MigrationImportResponse>;
  getImport: (
    importId: string,
    actor: ProjectActor,
  ) => Promise<MigrationImportResponse>;
  cancelImport: (
    importId: string,
    actor: ProjectActor,
  ) => Promise<MigrationImportResponse>;
  commitImport: (
    importId: string,
    input: unknown,
    actor: ProjectActor,
  ) => Promise<MigrationImportCommitResponse>;
}

export interface MigrationImportObjectStorage {
  createPresignedUpload: (input: {
    objectKey: string;
    mimeType: string;
    byteSize: number;
    expiresInSeconds: number;
  }) => Promise<{
    method: "PUT" | "POST";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  }>;
  initiateMultipartUpload: (input: {
    objectKey: string;
    mimeType: string;
  }) => Promise<{ uploadId: string }>;
  createPresignedUploadPart: (input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    byteSize: number;
    expiresInSeconds: number;
  }) => Promise<{
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  }>;
  completeMultipartUpload: (input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) => Promise<void>;
  abortMultipartUpload: (input: {
    objectKey: string;
    uploadId: string;
  }) => Promise<void>;
  getObjectMetadata: (objectKey: string) => Promise<{
    byteSize: number;
    mimeType: string | null;
  }>;
  calculateObjectSha256: (objectKey: string) => Promise<string>;
  deleteObject: (objectKey: string) => Promise<void>;
}

export function normalizeMigrationImportId(importId: unknown) {
  if (typeof importId !== "string" || !UUID_PATTERN.test(importId)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid migration import id",
    });
  }
  return importId.toLowerCase();
}

export function migrationImportNotFound(): never {
  throw new AuthServiceError({
    statusCode: 404,
    apiCode: "RESOURCE_NOT_FOUND",
    message: "Migration import not found",
  });
}

export function createUnavailableMigrationImportService(): MigrationImportService {
  const unavailable = () => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: "SERVICE_UNAVAILABLE",
      message: "Migration import service is not configured",
      retryable: true,
    });
  };

  return {
    async prepareImport() {
      return unavailable();
    },
    async getImport() {
      return unavailable();
    },
    async cancelImport() {
      return unavailable();
    },
    async commitImport() {
      return unavailable();
    },
  };
}
