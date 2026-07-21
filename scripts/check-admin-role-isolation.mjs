import pg from 'pg'
import { loadDotEnv } from '@ai-canvas-cloud/server'

loadDotEnv()

const connections = {
  app: process.env.DATABASE_URL,
  admin: process.env.ADMIN_DATABASE_URL,
}

if (!connections.app || !connections.admin) throw new Error('Missing DATABASE_URL or ADMIN_DATABASE_URL')

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
    try { await client.query('SELECT 1 FROM admin."user" LIMIT 1') } catch { adminIdentityRead = false }
    try { await client.query('SELECT 1 FROM public."user" LIMIT 1') } catch { ordinaryIdentityRead = false }
    console.log({
      connection,
      role: identity.rows[0]?.role,
      isSuperuser: identity.rows[0]?.rolsuper,
      adminSchemaUsage: identity.rows[0]?.admin_usage,
      adminIdentityRead,
      ordinaryIdentityRead,
    })
  } finally {
    await client.end()
  }
}
