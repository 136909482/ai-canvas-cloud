import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { createS3ObjectStorage } from '../../dist/modules/assets/s3ObjectStorage.js'

loadDotEnv()

const config = {
  endpoint: process.env.S3_ENDPOINT,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
}
const hasObjectStorage = Object.values(config).every((value) => Boolean(value))

test('S3 adapter reads, lists, checks, and idempotently deletes a private MinIO object', {
  skip: hasObjectStorage ? false : 'S3 object storage is not configured',
}, async () => {
  const endpoint = config.endpoint!
  const bucket = config.bucket!
  const region = config.region!
  const credentials = {
    accessKeyId: config.accessKeyId!,
    secretAccessKey: config.secretAccessKey!,
  }
  const client = new S3Client({ endpoint, region, credentials, forcePathStyle: true })
  const storage = createS3ObjectStorage({ endpoint, bucket, region, ...credentials, forcePathStyle: true })
  const workspaceId = randomUUID()
  const projectId = randomUUID()
  const assetId = randomUUID()
  const objectKey = `workspaces/${workspaceId}/projects/${projectId}/uploads/${assetId}.png`
  const body = `asset-read-${randomUUID()}`

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: 'text/plain',
    }))

    const unsignedUrl = `${endpoint.replace(/\/$/, '')}/${bucket}/${objectKey}`
    const unsignedResponse = await fetch(unsignedUrl)
    assert.equal(unsignedResponse.status, 403)

    const signed = await storage.createPresignedDownload({ objectKey, expiresInSeconds: 60 })
    const signedResponse = await fetch(signed.url)
    assert.equal(signedResponse.status, 200)
    assert.equal(await signedResponse.text(), body)
    assert(new Date(signed.expiresAt).getTime() > Date.now())
    assert.equal(signed.url.includes(credentials.secretAccessKey), false)

    assert.equal(await storage.objectExists(objectKey), true)
    const listed = await storage.listObjectsPage({
      prefix: 'workspaces/',
      maxKeys: 500,
    })
    assert(listed.objects.some((object) => object.objectKey === objectKey && object.byteSize === Buffer.byteLength(body)))

    await storage.deleteObject(objectKey)
    assert.equal(await storage.objectExists(objectKey), false)
    await storage.deleteObject(objectKey)
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
    client.destroy()
  }
})
