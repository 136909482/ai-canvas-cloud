import { createHash } from 'node:crypto'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { AssetMaintenanceObjectStorage } from './assetMaintenance.js'
import type { AssetObjectStorage } from './service.js'

export interface S3ObjectStorageOptions {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
}

function isObjectNotFound(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const name = 'name' in error ? error.name : null
  const metadata = '$metadata' in error && error.$metadata && typeof error.$metadata === 'object'
    ? error.$metadata
    : null
  const statusCode = metadata && 'httpStatusCode' in metadata ? metadata.httpStatusCode : null
  return name === 'NotFound' || name === 'NoSuchKey' || statusCode === 404
}

export function createS3ObjectStorage(options: S3ObjectStorageOptions): AssetObjectStorage & AssetMaintenanceObjectStorage {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle ?? true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  })

  return {
    async createPresignedUpload(input) {
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000)
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ContentLength: input.byteSize,
      })

      return {
        method: 'PUT',
        url: await getSignedUrl(client, command, { expiresIn: input.expiresInSeconds }),
        headers: {
          'content-type': input.mimeType,
        },
        expiresAt: expiresAt.toISOString(),
      }
    },

    async createPresignedDownload(input) {
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000)
      const command = new GetObjectCommand({
        Bucket: options.bucket,
        Key: input.objectKey,
      })

      return {
        url: await getSignedUrl(client, command, { expiresIn: input.expiresInSeconds }),
        expiresAt: expiresAt.toISOString(),
      }
    },

    async getObjectMetadata(objectKey) {
      const result = await client.send(new HeadObjectCommand({
        Bucket: options.bucket,
        Key: objectKey,
      }))

      return {
        byteSize: result.ContentLength ?? 0,
        mimeType: result.ContentType ?? null,
      }
    },

    async calculateObjectSha256(objectKey) {
      const result = await client.send(new GetObjectCommand({
        Bucket: options.bucket,
        Key: objectKey,
      }))

      if (!result.Body || !(Symbol.asyncIterator in Object(result.Body))) {
        throw new Error('Object body is not readable')
      }

      const hash = createHash('sha256')
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
      }

      return hash.digest('hex')
    },

    async objectExists(objectKey) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: options.bucket, Key: objectKey }))
        return true
      } catch (error) {
        if (isObjectNotFound(error)) {
          return false
        }
        throw error
      }
    },

    async listObjectsPage(input) {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: input.prefix,
        StartAfter: input.startAfter ?? undefined,
        MaxKeys: input.maxKeys,
      }))
      const objects = (result.Contents ?? []).flatMap((object) => object.Key
        ? [{
            objectKey: object.Key,
            byteSize: object.Size ?? 0,
            lastModified: object.LastModified?.toISOString() ?? null,
          }]
        : [])
      return {
        objects,
        nextStartAfter: result.IsTruncated
          ? (objects.at(-1)?.objectKey ?? null)
          : null,
      }
    },

    async deleteObject(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: objectKey }))
    },
  }
}
