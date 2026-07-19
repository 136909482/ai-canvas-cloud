import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { createRecoveryFingerprint, requiredEnv } from './recovery-common.mjs'

export async function verifyStagingSourceUnchanged(env = process.env) {
  const directory = requiredEnv(env, 'BACKUP_DIRECTORY')
  const backupId = requiredEnv(env, 'RESTORE_BACKUP_ID')
  if (!/^[0-9TZ-]+$/.test(backupId)) throw new Error('RESTORE_BACKUP_ID is invalid')
  const mode = requiredEnv(env, 'SOURCE_GUARD_MODE')
  if (!['record', 'verify'].includes(mode)) throw new Error('SOURCE_GUARD_MODE must be record or verify')
  const guardPath = join(directory, `${backupId}.source-guard.json`)
  const client = new pg.Client({ connectionString: requiredEnv(env, 'DATABASE_URL') })
  try {
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const fingerprint = await createRecoveryFingerprint(client)
    await client.query('COMMIT')
    if (mode === 'record') {
      await fs.writeFile(guardPath, `${JSON.stringify(fingerprint)}\n`, { encoding: 'utf8', mode: 0o600 })
    } else if (JSON.stringify(fingerprint) !== await fs.readFile(guardPath, 'utf8').then((value) => value.trim())) {
      throw new Error('Source changed during the controlled restore drill')
    }
    console.log(JSON.stringify({ event: mode === 'record' ? 'staging_source_guard_recorded' : 'staging_source_unchanged', backupId }))
  } finally {
    await client.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  verifyStagingSourceUnchanged().catch((error) => {
    console.error(JSON.stringify({ event: 'staging_source_verification_failed', error: error instanceof Error ? error.name : 'UnknownError' }))
    process.exitCode = 1
  })
}
