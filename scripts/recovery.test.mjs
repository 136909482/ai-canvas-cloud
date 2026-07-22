import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { backupLifecycleRules, primaryLifecycleRules } from './configure-object-lifecycle.mjs'
import {
  assertRestoreIsolation,
  decryptBackup,
  encryptBackup,
  parseEncryptionKey,
  pruneBackupFiles,
  sha256File,
} from './recovery-common.mjs'

function restoreEnv(overrides = {}) {
  return {
    DATABASE_RESOURCE_ID: 'staging-postgres',
    RESTORE_DATABASE_RESOURCE_ID: 'staging-restore-postgres',
    REDIS_RESOURCE_ID: 'staging-redis',
    RESTORE_REDIS_RESOURCE_ID: 'staging-restore-redis',
    S3_RESOURCE_ID: 'staging-bucket',
    RESTORE_S3_RESOURCE_ID: 'staging-restore-bucket',
    S3_BUCKET: 'staging-assets',
    RESTORE_S3_BUCKET: 'staging-restore-assets',
    RESTORE_DATABASE_URL: 'postgres://restore_user:secret@restore-postgres:5432/staging_restore',
    RESTORE_RESET_CONFIRMED: 'true',
    ...overrides,
  }
}

test('backup encryption is authenticated and detects tampering', async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'ai-canvas-recovery-'))
  const source = join(directory, 'source.dump')
  const encrypted = join(directory, 'backup.dump.enc')
  const restored = join(directory, 'restored.dump')
  const key = randomBytes(32)
  try {
    await fs.writeFile(source, randomBytes(8192))
    await encryptBackup(source, encrypted, key)
    await decryptBackup(encrypted, restored, key)
    assert.equal(await sha256File(restored), await sha256File(source))

    const bytes = await fs.readFile(encrypted)
    bytes[Math.floor(bytes.length / 2)] ^= 1
    await fs.writeFile(encrypted, bytes)
    await assert.rejects(() => decryptBackup(encrypted, restored, key))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('restore isolation requires distinct restore-only database, Redis, and bucket resources', () => {
  assert.equal(assertRestoreIsolation(restoreEnv()), true)
  assert.throws(() => assertRestoreIsolation(restoreEnv({ RESTORE_S3_BUCKET: 'staging-assets' })), /restore-only/)
  assert.throws(() => assertRestoreIsolation(restoreEnv({ RESTORE_DATABASE_URL: 'postgres://user:secret@postgres:5432/staging' })), /restore-only/)
  assert.throws(() => assertRestoreIsolation(restoreEnv({ RESTORE_RESET_CONFIRMED: 'false' })), /must be true/)
  assert.throws(() => parseEncryptionKey(Buffer.alloc(31).toString('base64')), /32-byte/)
})

test('object lifecycle retains current formal assets and expires backup snapshots separately', () => {
  const primary = primaryLifecycleRules(30)
  assert.equal(primary.some((rule) => rule.Expiration?.Days), false)
  assert.equal(primary.find((rule) => rule.ID === 'retain-noncurrent-formal-assets')?.NoncurrentVersionExpiration.NoncurrentDays, 30)
  assert.equal(backupLifecycleRules(14)[0].Expiration.Days, 14)
})

test('backup retention removes only recognized expired artifacts', async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'ai-canvas-retention-'))
  try {
    const old = join(directory, '2026-01-01T00-00-00-000Z.dump.enc')
    const ignored = join(directory, 'keep.txt')
    await fs.writeFile(old, 'old')
    await fs.writeFile(ignored, 'keep')
    await fs.utimes(old, new Date(0), new Date(0))
    assert.equal(await pruneBackupFiles(directory, 1, Date.now()), 1)
    assert.equal(await fs.readFile(ignored, 'utf8'), 'keep')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
