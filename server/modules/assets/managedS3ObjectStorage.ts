import type { DbPool } from "../../db/postgres.js";
import {
  decryptObjectStorageCredentials,
  type ObjectStorageCredentialEnvelope,
  type ObjectStorageCredentialKeyring,
} from "./objectStorageCredentials.js";
import {
  createS3ObjectStorage,
  type S3ObjectStorageOptions,
} from "./s3ObjectStorage.js";

type S3ObjectStorage = ReturnType<typeof createS3ObjectStorage>;

interface PublicationRow {
  revision_id: string;
  endpoint: string;
  public_endpoint: string;
  region: string;
  bucket: string;
  force_path_style: boolean;
  encrypted_credentials_json: ObjectStorageCredentialEnvelope;
}

export interface ManagedS3ObjectStorage extends S3ObjectStorage {
  invalidateManagedConfig: () => void;
}

export function createManagedS3ObjectStorage(
  pool: DbPool,
  options: {
    keyring: ObjectStorageCredentialKeyring;
    fallback: S3ObjectStorageOptions;
    cacheTtlMs?: number;
  },
): ManagedS3ObjectStorage {
  const fallback = createS3ObjectStorage(options.fallback);
  const clients = new Map<string, S3ObjectStorage>();
  const cacheTtlMs = options.cacheTtlMs ?? 2_000;
  let cached:
    | { revisionId: string | null; storage: S3ObjectStorage; expiresAt: number }
    | undefined;

  async function resolve() {
    if (cached && cached.expiresAt > Date.now()) return cached.storage;
    const result = await pool.query<PublicationRow>(`
      SELECT revision_id::text, endpoint, public_endpoint, region, bucket,
             force_path_style, encrypted_credentials_json
      FROM public.object_storage_config_publications
      WHERE singleton_id = 1
    `);
    const row = result.rows[0];
    if (!row) {
      cached = {
        revisionId: null,
        storage: fallback,
        expiresAt: Date.now() + cacheTtlMs,
      };
      return fallback;
    }
    let storage = clients.get(row.revision_id);
    if (!storage) {
      const credentials = decryptObjectStorageCredentials(
        row.encrypted_credentials_json,
        row.revision_id,
        options.keyring,
      );
      storage = createS3ObjectStorage({
        endpoint: row.endpoint,
        publicEndpoint: row.public_endpoint,
        region: row.region,
        bucket: row.bucket,
        forcePathStyle: row.force_path_style,
        ...credentials,
      });
      clients.set(row.revision_id, storage);
    }
    cached = {
      revisionId: row.revision_id,
      storage,
      expiresAt: Date.now() + cacheTtlMs,
    };
    return storage;
  }

  return {
    invalidateManagedConfig() {
      cached = undefined;
    },
    destroy() {
      fallback.destroy();
      for (const storage of clients.values()) storage.destroy();
      clients.clear();
    },
    async checkHealth() {
      await (await resolve()).checkHealth();
    },
    async createPresignedUpload(input) {
      return (await resolve()).createPresignedUpload(input);
    },
    async initiateMultipartUpload(input) {
      return (await resolve()).initiateMultipartUpload(input);
    },
    async createPresignedUploadPart(input) {
      return (await resolve()).createPresignedUploadPart(input);
    },
    async completeMultipartUpload(input) {
      return (await resolve()).completeMultipartUpload(input);
    },
    async abortMultipartUpload(input) {
      return (await resolve()).abortMultipartUpload(input);
    },
    async createPresignedDownload(input) {
      return (await resolve()).createPresignedDownload(input);
    },
    async getObjectMetadata(objectKey) {
      return (await resolve()).getObjectMetadata(objectKey);
    },
    async calculateObjectSha256(objectKey) {
      return (await resolve()).calculateObjectSha256(objectKey);
    },
    async getObjectBytes(input) {
      return (await resolve()).getObjectBytes(input);
    },
    async putObject(input) {
      return (await resolve()).putObject(input);
    },
    async objectExists(objectKey) {
      return (await resolve()).objectExists(objectKey);
    },
    async listObjectsPage(input) {
      return (await resolve()).listObjectsPage(input);
    },
    async deleteObject(objectKey) {
      return (await resolve()).deleteObject(objectKey);
    },
  };
}
