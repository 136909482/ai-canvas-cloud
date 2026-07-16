import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import pg from 'pg'
import { loadDotEnv } from '../../dist/env/loadDotEnv.js'
import { createS3ObjectStorage } from '../../dist/modules/assets/s3ObjectStorage.js'
import { createPostgresAssetService } from '../../dist/modules/assets/service.js'
import { createPostgresProjectService } from '../../dist/modules/projects/postgresProjectService.js'

loadDotEnv()

const config = {
  databaseUrl: process.env.DATABASE_URL,
  endpoint: process.env.S3_ENDPOINT,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
}
const hasCloudDependencies = Object.values(config).every((value) => Boolean(value))

test('PostgreSQL upload sessions complete a real private MinIO round trip', {
  skip: hasCloudDependencies ? false : 'PostgreSQL and S3 object storage are not configured',
  timeout: 30_000,
}, async () => {
  const schemaName = `asset_upload_test_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: config.databaseUrl! })
  const s3Client = new S3Client({
    endpoint: config.endpoint!,
    region: config.region!,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId!,
      secretAccessKey: config.secretAccessKey!,
    },
  })
  let pool: pg.Pool | undefined
  let objectKey: string | null = null

  try {
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schemaName}"`)
    pool = new pg.Pool({
      connectionString: config.databaseUrl!,
      max: 2,
      options: `-c search_path=${schemaName},public`,
    })

    const migrationFiles = (await readdir(join(process.cwd(), 'server', 'db', 'migrations')))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort()
    for (const fileName of migrationFiles) {
      await pool.query(await readFile(join(process.cwd(), 'server', 'db', 'migrations', fileName), 'utf8'))
    }

    await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('asset-upload-user', 'Asset upload user', 'asset-upload@example.com', true)
    `)
    await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Asset upload workspace', 'asset-upload-user')
    `)
    await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'asset-upload-user', 'owner')
    `)

    const objectStorage = createS3ObjectStorage({
      endpoint: config.endpoint!,
      bucket: config.bucket!,
      region: config.region!,
      accessKeyId: config.accessKeyId!,
      secretAccessKey: config.secretAccessKey!,
      forcePathStyle: true,
    })
    const projects = createPostgresProjectService(pool)
    const assets = createPostgresAssetService(pool, { objectStorage })
    const actor = {
      userId: 'asset-upload-user',
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }
    const project = (await projects.createProject({ name: 'Real MinIO upload' }, actor)).project
    const body = Buffer.from(`private-upload-${randomUUID()}`)
    const sha256 = createHash('sha256').update(body).digest('hex')
    const created = await assets.createUpload({
      projectId: project.id,
      originalFileName: 'reference.png',
      mimeType: 'image/png',
      byteSize: body.byteLength,
      sha256,
      assetKind: 'upload',
      referenceRole: 'source',
      idempotencyKey: `asset_upload_${randomUUID()}`,
    }, actor)
    const objectResult = await pool.query<{ object_key: string }>(
      'SELECT object_key FROM assets WHERE id = $1',
      [created.asset.id],
    )
    objectKey = objectResult.rows[0]?.object_key ?? null
    assert(objectKey)

    const uploadResponse = await fetch(created.directUpload.url, {
      method: created.directUpload.method,
      headers: created.directUpload.headers,
      body,
    })
    assert.equal(uploadResponse.status, 200)

    const completed = await assets.completeUpload(created.upload.id, actor)
    assert.equal(completed.asset.status, 'completed')
    assert.equal(completed.asset.sha256, sha256)

    const signedRead = await assets.getAssetUrl(created.asset.id, actor)
    const readResponse = await fetch(signedRead.url)
    assert.equal(readResponse.status, 200)
    assert.deepEqual(Buffer.from(await readResponse.arrayBuffer()), body)
  } finally {
    if (objectKey) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: config.bucket!, Key: objectKey }))
    }
    s3Client.destroy()
    await pool?.end()
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
    await admin.end()
  }
})
