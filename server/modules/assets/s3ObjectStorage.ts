import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AssetMaintenanceObjectStorage } from "./assetMaintenance.js";
import type { AssetObjectStorage } from "./service.js";
import type { SiteAssetObjectStorage } from "../admin/siteConfigService.js";
import type { MigrationExportObjectStorage } from "../migrations/exportService.js";
import type { MigrationImportObjectStorage } from "../migrations/service.js";

export interface S3ObjectStorageOptions {
  endpoint: string;
  publicEndpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export interface S3ObjectStorageHealth {
  checkHealth: () => Promise<void>;
}

function isObjectNotFound(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? error.name : null;
  const metadata =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object"
      ? error.$metadata
      : null;
  const statusCode =
    metadata && "httpStatusCode" in metadata ? metadata.httpStatusCode : null;
  return name === "NotFound" || name === "NoSuchKey" || statusCode === 404;
}

export function createS3ObjectStorage(
  options: S3ObjectStorageOptions,
): AssetObjectStorage &
  AssetMaintenanceObjectStorage &
  SiteAssetObjectStorage &
  MigrationExportObjectStorage &
  MigrationImportObjectStorage &
  S3ObjectStorageHealth {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle ?? true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });
  const signingClient =
    options.publicEndpoint && options.publicEndpoint !== options.endpoint
      ? new S3Client({
          endpoint: options.publicEndpoint,
          region: options.region,
          forcePathStyle: options.forcePathStyle ?? true,
          credentials: {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
          },
        })
      : client;

  return {
    async checkHealth() {
      await client.send(new HeadBucketCommand({ Bucket: options.bucket }));
    },

    async createPresignedUpload(input) {
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ContentLength: input.byteSize,
      });

      return {
        method: "PUT",
        url: await getSignedUrl(signingClient, command, {
          expiresIn: input.expiresInSeconds,
        }),
        headers: {
          "content-type": input.mimeType,
        },
        expiresAt: expiresAt.toISOString(),
      };
    },

    async initiateMultipartUpload(input) {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: options.bucket,
          Key: input.objectKey,
          ContentType: input.mimeType,
        }),
      );
      if (!result.UploadId) {
        throw new Error("Object storage did not return a multipart upload ID");
      }
      return { uploadId: result.UploadId };
    },

    async createPresignedUploadPart(input) {
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
      const command = new UploadPartCommand({
        Bucket: options.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
        ContentLength: input.byteSize,
      });
      return {
        url: await getSignedUrl(signingClient, command, {
          expiresIn: input.expiresInSeconds,
        }),
        headers: {
          "content-length": String(input.byteSize),
        },
        expiresAt: expiresAt.toISOString(),
      };
    },

    async completeMultipartUpload(input) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: options.bucket,
          Key: input.objectKey,
          UploadId: input.uploadId,
          MultipartUpload: {
            Parts: input.parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      );
    },

    async abortMultipartUpload(input) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: options.bucket,
          Key: input.objectKey,
          UploadId: input.uploadId,
        }),
      );
    },

    async createPresignedDownload(input) {
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
      const command = new GetObjectCommand({
        Bucket: options.bucket,
        Key: input.objectKey,
      });

      return {
        url: await getSignedUrl(signingClient, command, {
          expiresIn: input.expiresInSeconds,
        }),
        expiresAt: expiresAt.toISOString(),
      };
    },

    async getObjectMetadata(objectKey) {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: options.bucket,
          Key: objectKey,
        }),
      );

      return {
        byteSize: result.ContentLength ?? 0,
        mimeType: result.ContentType ?? null,
      };
    },

    async calculateObjectSha256(objectKey) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: objectKey,
        }),
      );

      if (!result.Body || !(Symbol.asyncIterator in Object(result.Body))) {
        throw new Error("Object body is not readable");
      }

      const hash = createHash("sha256");
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
      }

      return hash.digest("hex");
    },

    async getObjectBytes(input) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: input.objectKey }),
      );
      if (!result.Body || !(Symbol.asyncIterator in Object(result.Body))) {
        throw new Error("Object body is not readable");
      }
      const chunks: Uint8Array[] = [];
      let byteSize = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        byteSize += chunk.byteLength;
        if (byteSize > input.maxBytes) {
          throw new Error("Object exceeds maximum input size");
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, byteSize);
    },

    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: input.objectKey,
          Body: input.body,
          ContentType: input.mimeType,
          ContentLength: input.body.byteLength,
        }),
      );
    },

    async objectExists(objectKey) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: options.bucket, Key: objectKey }),
        );
        return true;
      } catch (error) {
        if (isObjectNotFound(error)) {
          return false;
        }
        throw error;
      }
    },

    async listObjectsPage(input) {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: options.bucket,
          Prefix: input.prefix,
          StartAfter: input.startAfter ?? undefined,
          MaxKeys: input.maxKeys,
        }),
      );
      const objects = (result.Contents ?? []).flatMap((object) =>
        object.Key
          ? [
              {
                objectKey: object.Key,
                byteSize: object.Size ?? 0,
                lastModified: object.LastModified?.toISOString() ?? null,
              },
            ]
          : [],
      );
      return {
        objects,
        nextStartAfter: result.IsTruncated
          ? (objects.at(-1)?.objectKey ?? null)
          : null,
      };
    },

    async deleteObject(objectKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: options.bucket, Key: objectKey }),
      );
    },
  };
}
