import { createStagingBackup } from './create-staging-backup.mjs'
import { requiredEnv } from './recovery-common.mjs'

const intervalHours = Number(requiredEnv(process.env, 'BACKUP_INTERVAL_HOURS'))
if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168) {
  throw new Error('BACKUP_INTERVAL_HOURS must be between 1 and 168')
}

let running = false
async function cycle() {
  if (running) return
  running = true
  try {
    await createStagingBackup()
  } catch {
    // The backup command emits only a sanitized failure event and Pushgateway metric.
  } finally {
    running = false
  }
}

await cycle()
setInterval(cycle, intervalHours * 60 * 60 * 1000)
