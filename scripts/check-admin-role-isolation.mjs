import assert from 'node:assert/strict'
import pg from 'pg'
import { loadDotEnv } from '@ai-canvas-cloud/server'

loadDotEnv()

assert.equal(process.env.WORKER_DATABASE_URL?.trim() || null, null, 'WORKER_DATABASE_URL must be removed')

const connections = {
  app: process.env.DATABASE_URL,
  admin: process.env.ADMIN_DATABASE_URL,
}

if (!connections.app || !connections.admin) throw new Error('Missing DATABASE_URL or ADMIN_DATABASE_URL')

const expectedPermissions = {
  app: {
    isSuperuser: false,
    adminSchemaUsage: false,
    adminIdentityRead: false,
    adminLoginSecurityRead: false,
    adminLoginSecurityWrite: false,
    ordinaryIdentityRead: true,
    sitePublicationRead: true,
    sitePublicationWrite: false,
  },
  admin: {
    isSuperuser: false,
    adminSchemaUsage: true,
    adminIdentityRead: true,
    adminLoginSecurityRead: true,
    adminLoginSecurityWrite: true,
    ordinaryIdentityRead: false,
    sitePublicationRead: true,
    sitePublicationWrite: true,
  },
}

for (const [connection, connectionString] of Object.entries(connections)) {
  const client = new pg.Client({ connectionString })
  try {
    await client.connect()
    const identity = await client.query(`
      SELECT current_user AS role,
             rolsuper,
             has_schema_privilege(current_user, 'admin', 'USAGE') AS admin_usage
      FROM pg_roles
      WHERE rolname = current_user
    `)
    let adminIdentityRead = true
    let ordinaryIdentityRead = true
    let adminLoginSecurityRead = true
    let adminLoginSecurityWrite = true
    try { await client.query('SELECT 1 FROM admin."user" LIMIT 1') } catch { adminIdentityRead = false }
    try { await client.query('SELECT 1 FROM public."user" LIMIT 1') } catch { ordinaryIdentityRead = false }
    try { await client.query('SELECT 1 FROM admin.login_security_settings LIMIT 1') } catch { adminLoginSecurityRead = false }
    try { await client.query('UPDATE admin.login_security_settings SET updated_at = updated_at WHERE false') } catch { adminLoginSecurityWrite = false }
    const sitePublicationRead = await client.query(`SELECT has_table_privilege(current_user, 'public.site_config_publications', 'SELECT') AS allowed`)
    const sitePublicationWrite = await client.query(`SELECT has_table_privilege(current_user, 'public.site_config_publications', 'INSERT,UPDATE') AS allowed`)
    const removedSchema = await client.query(`
      SELECT to_regclass('public.generation_tasks') AS generation_tasks,
             to_regclass('public.provider_credentials') AS provider_credentials,
             to_regclass('public.task_queue_outbox') AS task_queue_outbox,
             to_regclass('public.usage_ledger') AS usage_ledger
    `)
    assert.deepEqual(removedSchema.rows[0], {
      generation_tasks: null,
      provider_credentials: null,
      task_queue_outbox: null,
      usage_ledger: null,
    })
    const legacyWorkerRole = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'ai_canvas_cloud_worker'`)
    assert.equal(legacyWorkerRole.rowCount, 0, 'legacy Worker database role must be removed')
    const permissions = {
      isSuperuser: identity.rows[0]?.rolsuper,
      adminSchemaUsage: identity.rows[0]?.admin_usage,
      adminIdentityRead,
      adminLoginSecurityRead,
      adminLoginSecurityWrite,
      ordinaryIdentityRead,
      sitePublicationRead: sitePublicationRead.rows[0]?.allowed,
      sitePublicationWrite: sitePublicationWrite.rows[0]?.allowed,
    }
    console.log({ connection, role: identity.rows[0]?.role, ...permissions })
    assert.deepEqual(permissions, expectedPermissions[connection], `${connection} database role permissions are not isolated`)
  } finally {
    await client.end()
  }
}
