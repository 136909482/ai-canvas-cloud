import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const migrationsDir = join(process.cwd(), 'server', 'db', 'migrations')
const migrationPattern = /^(\d{4})_[a-z0-9_]+\.sql$/

function readDotEnv() {
  const envPath = join(process.cwd(), '.env')

  if (!existsSync(envPath)) {
    return
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    process.env[key] ??= value.replace(/^"(.*)"$/, '$1')
  }
}

function loadMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    throw new Error('No database migrations found.')
  }

  const seenVersions = new Set()

  return files.map((fileName, index) => {
    const match = migrationPattern.exec(fileName)

    if (!match) {
      throw new Error(`Invalid migration filename: ${fileName}`)
    }

    const version = match[1]

    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`)
    }

    if (Number(version) !== index + 1) {
      throw new Error(`Migration versions must be contiguous from 0001: ${fileName}`)
    }

    seenVersions.add(version)
    const sql = readFileSync(join(migrationsDir, fileName), 'utf8').trim()

    if (!sql) {
      throw new Error(`Empty migration: ${fileName}`)
    }

    if (/\bDROP\s+DATABASE\b/i.test(sql)) {
      throw new Error(`Unsafe migration statement in ${fileName}`)
    }

    return { fileName, version, sql }
  })
}

async function expectRejected(client, text, values, message) {
  await client.query('SAVEPOINT expected_failure')

  try {
    await client.query(text, values)
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure')
    await client.query('RELEASE SAVEPOINT expected_failure')
    return
  }

  await client.query('ROLLBACK TO SAVEPOINT expected_failure')
  await client.query('RELEASE SAVEPOINT expected_failure')
  throw new Error(message)
}

async function assertProjectGraphSchema(client, schemaName) {
  const tables = ['projects', 'project_nodes', 'project_edges', 'project_changes', 'project_snapshots']
  const tableResult = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name = ANY($2::text[])
    `,
    [schemaName, tables],
  )

  if (tableResult.rowCount !== tables.length) {
    throw new Error('Project graph migration did not create all required tables')
  }

  const requiredConstraints = [
    'project_changes_idempotency_unique',
    'project_edges_source_node_fk',
    'project_edges_target_node_fk',
    'projects_saved_snapshot_fk',
    'workspace_user_state_active_project_fk',
    'workspace_user_state_last_opened_project_fk',
  ]
  const constraintResult = await client.query(
    `
      SELECT conname
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1
        AND conname = ANY($2::text[])
    `,
    [schemaName, requiredConstraints],
  )

  if (constraintResult.rowCount !== requiredConstraints.length) {
    throw new Error('Project graph migration is missing required tenant or graph constraints')
  }

  const requiredIndexes = [
    'projects_workspace_active_updated_idx',
    'projects_workspace_archived_updated_idx',
    'project_changes_project_created_idx',
    'project_snapshots_project_valid_sequence_idx',
  ]
  const indexResult = await client.query(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = $1
        AND indexname = ANY($2::text[])
    `,
    [schemaName, requiredIndexes],
  )

  if (indexResult.rowCount !== requiredIndexes.length) {
    throw new Error('Project graph migration is missing required list or history indexes')
  }

  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('migration-user', 'Migration User', 'migration-user@example.com', true)
  `)
  await client.query(`
    INSERT INTO workspaces (id, name, owner_user_id)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Migration workspace', 'migration-user')
  `)
  await client.query(`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'migration-user', 'owner')
  `)
  await client.query(`
    INSERT INTO projects (id, workspace_id, name)
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Migration project'
    )
  `)
  await client.query(`
    INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'node-a', 'text', 0, 0),
      ('11111111-1111-4111-8111-111111111111', 'node-b', 'text', 100, 0)
  `)
  await client.query(`
    INSERT INTO project_edges (project_id, edge_id, source_node_id, target_node_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'edge-a-b', 'node-a', 'node-b')
  `)
  await client.query(`
    INSERT INTO project_changes (
      project_id,
      sequence,
      base_version,
      result_version,
      actor_user_id,
      client_id,
      batch_id,
      idempotency_key,
      source,
      operations_json
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      1,
      0,
      1,
      'migration-user',
      'migration-client',
      'migration-batch',
      'migration-idempotency',
      'user',
      '[]'::jsonb
    )
  `)
  await client.query(`
    INSERT INTO projects (id, workspace_id, name)
    VALUES (
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Second migration project'
    )
  `)
  const snapshotResult = await client.query(`
    INSERT INTO project_snapshots (
      project_id, project_version, last_sequence, snapshot_type,
      schema_version, record_json, byte_size, is_valid
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      1,
      1,
      'manual',
      1,
      '{}'::jsonb,
      2,
      true
    )
    RETURNING id::text
  `)

  await expectRejected(
    client,
    `INSERT INTO projects (workspace_id, name) VALUES ($1, '   ')`,
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    'Project name constraint accepted a blank name',
  )
  await expectRejected(
    client,
    `
      INSERT INTO project_edges (project_id, edge_id, source_node_id, target_node_id)
      VALUES ($1, 'missing-edge', 'node-a', 'missing-node')
    `,
    ['11111111-1111-4111-8111-111111111111'],
    'Project edge constraint accepted a missing target node',
  )
  await expectRejected(
    client,
    `
      INSERT INTO project_changes (
        project_id, sequence, base_version, result_version, actor_user_id,
        batch_id, idempotency_key, source, operations_json
      ) VALUES ($1, 2, 1, 2, 'migration-user', 'second-batch', 'migration-idempotency', 'user', '[]'::jsonb)
    `,
    ['11111111-1111-4111-8111-111111111111'],
    'Project change constraint accepted a duplicate idempotency key',
  )
  await expectRejected(
    client,
    `UPDATE projects SET saved_snapshot_id = $1 WHERE id = $2`,
    [snapshotResult.rows[0].id, '22222222-2222-4222-8222-222222222222'],
    'Project snapshot scope constraint accepted another project snapshot',
  )
}

readDotEnv()
const migrations = loadMigrations()
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Migration tests require a disposable PostgreSQL schema.')
}

const schemaName = `migration_test_${randomUUID().replaceAll('-', '')}`
const client = new pg.Client({ connectionString: databaseUrl })

try {
  await client.connect()
  await client.query(`CREATE SCHEMA "${schemaName}"`)
  await client.query(`SET search_path TO "${schemaName}", public`)
  await client.query('BEGIN')

  for (const migration of migrations) {
    await client.query(migration.sql)
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.fileName],
    )
  }

  await assertProjectGraphSchema(client, schemaName)
  await client.query('ROLLBACK')
  console.log(`Checked and upgraded ${migrations.length} migration file(s) in an isolated PostgreSQL schema.`)
} finally {
  if (client.readyForQuery) {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  }
  await client.end()
}
