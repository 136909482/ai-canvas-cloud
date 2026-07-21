import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const envPath = join(process.cwd(), '.env')
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/

function parseEnv(text) {
  const output = new Map()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index > 0) output.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim().replace(/^"(.*)"$/, '$1'))
  }
  return output
}

function updateEnv(text, updates) {
  const remaining = new Map(Object.entries(updates))
  const lines = text.split(/\r?\n/).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())
    if (!match || !remaining.has(match[1])) return line
    const value = remaining.get(match[1])
    remaining.delete(match[1])
    return `${match[1]}=${value}`
  })
  if (lines.at(-1) !== '') lines.push('')
  lines.push('# P8 Admin isolation (local secrets; never commit)')
  for (const [key, value] of remaining) lines.push(`${key}=${value}`)
  lines.push('')
  return lines.join('\n')
}

function secret() {
  return randomBytes(36).toString('base64url')
}

function safeRole(value, fallback) {
  const role = value?.trim() || fallback
  if (!IDENTIFIER.test(role)) throw new Error('Database role name is invalid')
  return role
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function roleUrl(source, role, password) {
  const url = new URL(source)
  url.username = role
  url.password = password
  return url.toString()
}

if (!existsSync(envPath)) throw new Error('Missing .env')
const text = readFileSync(envPath, 'utf8')
const env = parseEnv(text)
const migrationUrl = env.get('MIGRATION_DATABASE_URL') || env.get('DATABASE_URL')
if (!migrationUrl) throw new Error('Missing DATABASE_URL or MIGRATION_DATABASE_URL')
const appRole = safeRole(env.get('APP_DATABASE_ROLE'), 'ai_canvas_cloud_app')
const adminRole = safeRole(env.get('ADMIN_DATABASE_ROLE'), 'ai_canvas_cloud_admin')
if (appRole === adminRole) throw new Error('Application and Admin database roles must be different')
const appPassword = env.get('APP_DATABASE_PASSWORD') || secret()
const adminPassword = env.get('ADMIN_DATABASE_PASSWORD') || secret()
const adminAuthSecret = env.get('ADMIN_BETTER_AUTH_SECRET') || secret() + secret()
const client = new pg.Client({ connectionString: migrationUrl })

async function ensureRole(role, password) {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
  const roleSql = quoteIdentifier(role)
  const passwordSql = quoteLiteral(password)
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${roleSql} LOGIN PASSWORD ${passwordSql} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`)
  } else if (!env.get(role === appRole ? 'APP_DATABASE_PASSWORD' : 'ADMIN_DATABASE_PASSWORD')) {
    await client.query(`ALTER ROLE ${roleSql} PASSWORD ${passwordSql}`)
  }
}

try {
  await client.connect()
  const database = await client.query('SELECT current_database() AS name, current_user AS owner')
  const databaseName = database.rows[0]?.name
  const ownerRole = database.rows[0]?.owner
  if (!databaseName || !ownerRole || !IDENTIFIER.test(ownerRole)) throw new Error('Could not resolve migration database owner')
  await ensureRole(appRole, appPassword)
  await ensureRole(adminRole, adminPassword)
  const app = quoteIdentifier(appRole)
  const admin = quoteIdentifier(adminRole)
  const owner = quoteIdentifier(ownerRole)
  const databaseIdentifier = quoteIdentifier(databaseName)
  await client.query('BEGIN')
  await client.query(`GRANT CONNECT, CREATE ON DATABASE ${databaseIdentifier} TO ${app}`)
  await client.query(`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${admin}`)
  await client.query(`GRANT USAGE ON SCHEMA public TO ${app}`)
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`)
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`)
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`)
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`)
  await client.query(`REVOKE ALL ON SCHEMA admin FROM ${app}`)
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM ${app}`)
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM ${app}`)
  await client.query(`GRANT USAGE ON SCHEMA admin TO ${admin}`)
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA admin TO ${admin}`)
  await client.query(`REVOKE UPDATE, DELETE ON admin.audit_events FROM ${admin}`)
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA admin TO ${admin}`)
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA admin GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${admin}`)
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA admin GRANT USAGE, SELECT ON SEQUENCES TO ${admin}`)
  await client.query(`ALTER ROLE ${app} SET search_path = public`)
  await client.query(`ALTER ROLE ${admin} SET search_path = admin`)
  await client.query('COMMIT')

  const updates = {
    MIGRATION_DATABASE_URL: migrationUrl,
    APP_DATABASE_ROLE: appRole,
    APP_DATABASE_PASSWORD: appPassword,
    DATABASE_URL: roleUrl(migrationUrl, appRole, appPassword),
    ADMIN_DATABASE_ROLE: adminRole,
    ADMIN_DATABASE_PASSWORD: adminPassword,
    ADMIN_DATABASE_URL: roleUrl(migrationUrl, adminRole, adminPassword),
    ADMIN_API_HOST: env.get('ADMIN_API_HOST') || '127.0.0.1',
    ADMIN_API_PORT: env.get('ADMIN_API_PORT') || '8788',
    ADMIN_BETTER_AUTH_URL: env.get('ADMIN_BETTER_AUTH_URL') || 'http://127.0.0.1:8788',
    ADMIN_BETTER_AUTH_SECRET: adminAuthSecret,
    ADMIN_WEB_HOST: env.get('ADMIN_WEB_HOST') || '127.0.0.1',
    ADMIN_WEB_PORT: env.get('ADMIN_WEB_PORT') || '5174',
    ADMIN_WEB_PUBLIC_URL: env.get('ADMIN_WEB_PUBLIC_URL') || 'http://localhost:5174',
    ADMIN_WEB_ALLOWED_ORIGINS: env.get('ADMIN_WEB_ALLOWED_ORIGINS') || 'http://localhost:5174,http://127.0.0.1:5174',
  }
  writeFileSync(envPath, updateEnv(text, updates), { encoding: 'utf8', flag: 'w' })
  console.log(`Database role isolation configured for ${appRole} and ${adminRole}; secret values were not printed.`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}
