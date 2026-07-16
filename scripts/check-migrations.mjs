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
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure')
    await client.query('RELEASE SAVEPOINT expected_failure')
    return
  }

  await client.query('ROLLBACK TO SAVEPOINT expected_failure')
  await client.query('RELEASE SAVEPOINT expected_failure')
  throw new Error(message)
}

async function assertAssetGovernanceSchema(client, schemaName) {
  const tables = ['assets', 'asset_uploads', 'asset_references']
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
    throw new Error('Asset governance migration did not create all required tables')
  }

  const requiredConstraints = [
    'assets_workspace_project_fk',
    'assets_object_key_unique',
    'asset_uploads_workspace_idempotency_unique',
    'asset_uploads_workspace_asset_fk',
    'asset_references_workspace_asset_fk',
    'asset_references_workspace_project_fk',
    'asset_references_project_node_fk',
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
    throw new Error('Asset governance migration is missing required tenant constraints')
  }

  const requiredIndexes = [
    'assets_workspace_status_updated_idx',
    'asset_uploads_workspace_pending_expiry_idx',
    'asset_references_node_unique_idx',
    'asset_references_task_unique_idx',
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
    throw new Error('Asset governance migration is missing required indexes')
  }

  await client.query(`
    INSERT INTO assets (
      id, workspace_id, origin_project_id, created_by_user_id, object_key,
      original_file_name, mime_type, byte_size, sha256, width, height, asset_kind, status
    ) VALUES (
      '55555555-5555-4555-8555-555555555555',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'migration-user',
      'workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/projects/11111111-1111-4111-8111-111111111111/uploads/55555555-5555-4555-8555-555555555555.png',
      'reference.png',
      'image/png',
      2048,
      repeat('a', 64),
      1024,
      768,
      'upload',
      'pending'
    )
  `)
  await client.query(`
    INSERT INTO asset_uploads (
      id, workspace_id, project_id, asset_id, created_by_user_id, object_key,
      original_file_name, expected_mime_type, expected_byte_size, expected_sha256,
      asset_kind, idempotency_key, expires_at
    ) VALUES (
      '66666666-6666-4666-8666-666666666666',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      '55555555-5555-4555-8555-555555555555',
      'migration-user',
      'workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/projects/11111111-1111-4111-8111-111111111111/uploads/55555555-5555-4555-8555-555555555555.png',
      'reference.png',
      'image/png',
      2048,
      repeat('a', 64),
      'upload',
      'migration-upload',
      now() + interval '1 hour'
    )
  `)
  await client.query(`
    INSERT INTO asset_references (
      workspace_id, asset_id, project_id, node_id, reference_role
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '55555555-5555-4555-8555-555555555555',
      '11111111-1111-4111-8111-111111111111',
      'node-a',
      'source'
    )
  `)

  await expectRejected(
    client,
    `
      INSERT INTO assets (
        workspace_id, origin_project_id, created_by_user_id, object_key,
        mime_type, byte_size, asset_kind
      ) VALUES (
        $1, $2, 'migration-user', 'bad/../object.png', 'image/png', 1, 'upload'
      )
    `,
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'],
    'Asset object key constraint accepted a traversal segment',
  )
  await expectRejected(
    client,
    `
      INSERT INTO asset_uploads (
        workspace_id, project_id, asset_id, created_by_user_id, object_key,
        original_file_name, expected_mime_type, expected_byte_size, asset_kind,
        idempotency_key, expires_at
      ) VALUES (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-4111-8111-111111111111',
        '55555555-5555-4555-8555-555555555555',
        'migration-user',
        'workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/projects/11111111-1111-4111-8111-111111111111/uploads/duplicate.png',
        'duplicate.png',
        'image/png',
        1024,
        'upload',
        'migration-upload',
        now() + interval '1 hour'
      )
    `,
    [],
    'Asset upload constraint accepted a duplicate workspace idempotency key',
  )
  await expectRejected(
    client,
    `
      INSERT INTO assets (
        workspace_id, origin_project_id, created_by_user_id, object_key,
        mime_type, byte_size, asset_kind
      ) VALUES (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '11111111-1111-4111-8111-111111111111',
        'migration-user',
        'workspaces/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/projects/11111111-1111-4111-8111-111111111111/uploads/cross.png',
        'image/png',
        1,
        'upload'
      )
    `,
    [],
    'Asset constraint accepted a project from another workspace',
  )
}

async function seedWorkspaceStorageQuotaUpgradeFixture(client) {
  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('quota-upgrade-user', 'Quota Upgrade', 'quota-upgrade@example.com', true)
  `)
  await client.query(`
    INSERT INTO workspaces (
      id, type, name, owner_user_id, storage_quota_bytes
    ) VALUES (
      '99999999-9999-4999-8999-999999999999',
      'personal',
      'Quota upgrade workspace',
      'quota-upgrade-user',
      0
    )
  `)
}

async function assertWorkspaceStorageQuotaMigration(client) {
  const upgraded = await client.query(`
    SELECT storage_quota_bytes
    FROM workspaces
    WHERE id = '99999999-9999-4999-8999-999999999999'
  `)
  if (upgraded.rows[0]?.storage_quota_bytes !== '21474836480') {
    throw new Error('Workspace storage quota migration did not backfill an existing personal workspace')
  }

  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('quota-default-user', 'Quota Default', 'quota-default@example.com', true)
  `)
  const created = await client.query(`
    INSERT INTO workspaces (name, owner_user_id)
    VALUES ('Quota default workspace', 'quota-default-user')
    RETURNING storage_quota_bytes
  `)
  if (created.rows[0]?.storage_quota_bytes !== '21474836480') {
    throw new Error('Workspace storage quota migration did not set the 20 GiB default')
  }
}

async function assertGenerationTaskLegacyReferenceGuard(client, migrationSql) {
  await client.query('SAVEPOINT generation_task_legacy_guard')
  try {
    await client.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES ('task-guard-user', 'Task Guard', 'task-guard@example.com', true)
    `)
    await client.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ('77777777-7777-4777-8777-777777777777', 'Task guard workspace', 'task-guard-user')
    `)
    await client.query(`
      INSERT INTO projects (id, workspace_id, name)
      VALUES (
        '77777777-7777-4777-8777-777777777778',
        '77777777-7777-4777-8777-777777777777',
        'Task guard project'
      )
    `)
    await client.query(`
      INSERT INTO assets (
        id, workspace_id, origin_project_id, created_by_user_id, object_key,
        mime_type, byte_size, asset_kind, status
      ) VALUES (
        '77777777-7777-4777-8777-777777777779',
        '77777777-7777-4777-8777-777777777777',
        '77777777-7777-4777-8777-777777777778',
        'task-guard-user',
        'workspaces/77777777-7777-4777-8777-777777777777/projects/77777777-7777-4777-8777-777777777778/uploads/77777777-7777-4777-8777-777777777779.png',
        'image/png', 1, 'upload', 'completed'
      )
    `)
    await client.query(`
      INSERT INTO asset_references (
        workspace_id, asset_id, project_id, task_id, reference_role
      ) VALUES (
        '77777777-7777-4777-8777-777777777777',
        '77777777-7777-4777-8777-777777777779',
        '77777777-7777-4777-8777-777777777778',
        '77777777-7777-4777-8777-777777777770',
        'result'
      )
    `)

    await client.query(migrationSql)
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT generation_task_legacy_guard')
    await client.query('RELEASE SAVEPOINT generation_task_legacy_guard')
    if (error instanceof Error && error.message.includes('legacy task asset references exist')) {
      return
    }
    throw error
  }

  await client.query('ROLLBACK TO SAVEPOINT generation_task_legacy_guard')
  await client.query('RELEASE SAVEPOINT generation_task_legacy_guard')
  throw new Error('Generation task migration accepted an unowned legacy task asset reference')
}

async function assertGenerationTaskSchema(client, schemaName) {
  const tables = ['generation_tasks', 'task_attempts']
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
    throw new Error('Generation task migration did not create all required tables')
  }

  const requiredConstraints = [
    'generation_tasks_workspace_project_fk',
    'generation_tasks_source_node_fk',
    'generation_tasks_preview_node_fk',
    'generation_tasks_workspace_idempotency_unique',
    'task_attempts_workspace_task_fk',
    'task_attempts_task_number_unique',
    'asset_references_workspace_task_fk',
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
    throw new Error('Generation task migration is missing required tenant constraints')
  }

  const requiredIndexes = [
    'generation_tasks_workspace_created_idx',
    'generation_tasks_project_created_idx',
    'generation_tasks_queue_claim_idx',
    'generation_tasks_running_lease_idx',
    'task_attempts_workspace_task_idx',
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
    throw new Error('Generation task migration is missing queue or history indexes')
  }

  const taskIdType = await client.query(`
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'asset_references' AND column_name = 'task_id'
  `, [schemaName])
  if (taskIdType.rows[0]?.udt_name !== 'uuid') {
    throw new Error('Generation task migration did not normalize asset task references to UUID')
  }

  await client.query(`
    INSERT INTO generation_tasks (
      id, workspace_id, project_id, created_by_user_id, source_node_id,
      preview_node_id, task_kind, provider_id, model_key, request_json, idempotency_key
    ) VALUES (
      '88888888-8888-4888-8888-888888888888',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'migration-user', 'node-a', 'node-b', 'image', 'openai', 'gpt-image-2',
      '{"prompt":"migration task"}'::jsonb, 'migration-task'
    )
  `)
  await client.query(`
    UPDATE generation_tasks
    SET status = 'running', progress = 10, attempt_count = 1,
        lease_owner = 'migration-worker', lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes', started_at = now()
    WHERE id = '88888888-8888-4888-8888-888888888888'
  `)
  await client.query(`
    INSERT INTO task_attempts (
      workspace_id, task_id, attempt_number, provider_id, model_key
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '88888888-8888-4888-8888-888888888888',
      1, 'openai', 'gpt-image-2'
    )
  `)
  await client.query(`
    INSERT INTO asset_references (
      workspace_id, asset_id, project_id, task_id, reference_role
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '55555555-5555-4555-8555-555555555555',
      '11111111-1111-4111-8111-111111111111',
      '88888888-8888-4888-8888-888888888888',
      'result'
    )
  `)

  await expectRejected(
    client,
    `
      INSERT INTO generation_tasks (
        workspace_id, project_id, created_by_user_id, source_node_id,
        task_kind, provider_id, model_key, idempotency_key
      ) VALUES (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '11111111-1111-4111-8111-111111111111',
        'migration-user-2', 'node-a', 'image', 'openai', 'gpt-image-2', 'cross-workspace-task'
      )
    `,
    [],
    'Generation task constraint accepted a project from another workspace',
  )
  await expectRejected(
    client,
    `
      INSERT INTO task_attempts (
        workspace_id, task_id, attempt_number, provider_id, model_key
      ) VALUES (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '88888888-8888-4888-8888-888888888888',
        2, 'openai', 'gpt-image-2'
      )
    `,
    [],
    'Task attempt constraint accepted a task from another workspace',
  )
  await expectRejected(
    client,
    `UPDATE generation_tasks SET status = 'succeeded' WHERE id = $1`,
    ['88888888-8888-4888-8888-888888888888'],
    'Generation task terminal status accepted a missing finished timestamp',
  )
}

async function assertProviderCredentialSchema(client, schemaName) {
  const tableResult = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = 'provider_credentials'
    `,
    [schemaName],
  )
  if (tableResult.rowCount !== 1) {
    throw new Error('Provider credential migration did not create its table')
  }

  const requiredConstraints = [
    'provider_credentials_workspace_provider_unique',
    'provider_credentials_envelope_object_check',
    'provider_credentials_base_url_check',
    'provider_credentials_status_check',
  ]
  const constraintResult = await client.query(
    `
      SELECT conname
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND conname = ANY($2::text[])
    `,
    [schemaName, requiredConstraints],
  )
  if (constraintResult.rowCount !== requiredConstraints.length) {
    throw new Error('Provider credential migration is missing required constraints')
  }

  const indexResult = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    [schemaName, 'provider_credentials_workspace_status_idx'],
  )
  if (indexResult.rowCount !== 1) {
    throw new Error('Provider credential migration is missing its workspace status index')
  }

  const envelope = JSON.stringify({
    algorithm: 'aes-256-gcm',
    keyVersion: 1,
    iv: 'migration-iv',
    ciphertext: 'migration-ciphertext',
    authTag: 'migration-auth-tag',
  })
  await client.query(`
    INSERT INTO provider_credentials (
      workspace_id, provider_id, base_url, encrypted_secret_json,
      key_version, secret_last_four, created_by_user_id, updated_by_user_id
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'openai', 'https://api.openai.com',
      $1::jsonb, 1, '1234', 'migration-user', 'migration-user'
    )
  `, [envelope])

  await expectRejected(
    client,
    `
      INSERT INTO provider_credentials (
        workspace_id, provider_id, base_url, encrypted_secret_json,
        key_version, secret_last_four, created_by_user_id, updated_by_user_id
      ) VALUES (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aliyun', 'http://127.0.0.1',
        $1::jsonb, 1, '1234', 'migration-user', 'migration-user'
      )
    `,
    [envelope],
    'Provider credential constraint accepted a non-HTTPS base URL',
  )
  await expectRejected(
    client,
    `
      INSERT INTO provider_credentials (
        workspace_id, provider_id, base_url, encrypted_secret_json,
        key_version, secret_last_four, created_by_user_id, updated_by_user_id
      ) VALUES (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aliyun',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        '{}'::jsonb, 1, '1234', 'migration-user', 'migration-user'
      )
    `,
    [],
    'Provider credential constraint accepted an incomplete encrypted envelope',
  )
}

async function assertTaskCommandSchema(client, schemaName) {
  const tableResult = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'task_commands'`,
    [schemaName],
  )
  if (tableResult.rowCount !== 1) {
    throw new Error('Task command migration did not create its table')
  }
  const requiredConstraints = [
    'task_commands_workspace_task_fk',
    'task_commands_workspace_idempotency_unique',
    'task_commands_type_check',
    'task_commands_idempotency_key_check',
  ]
  const constraintResult = await client.query(
    `
      SELECT conname FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND conname = ANY($2::text[])
    `,
    [schemaName, requiredConstraints],
  )
  if (constraintResult.rowCount !== requiredConstraints.length) {
    throw new Error('Task command migration is missing required tenant or idempotency constraints')
  }
  const indexResult = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = 'task_commands_task_created_idx'`,
    [schemaName],
  )
  if (indexResult.rowCount !== 1) {
    throw new Error('Task command migration is missing its task history index')
  }
  await client.query(`
    INSERT INTO task_commands (workspace_id, task_id, command_type, idempotency_key, created_by_user_id)
    VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '88888888-8888-4888-8888-888888888888',
      'cancel', 'migration-command', 'migration-user'
    )
  `)
  await expectRejected(
    client,
    `
      INSERT INTO task_commands (workspace_id, task_id, command_type, idempotency_key, created_by_user_id)
      VALUES (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '88888888-8888-4888-8888-888888888888',
        'retry', 'cross-workspace-command', 'migration-user-2'
      )
    `,
    [],
    'Task command constraint accepted a task from another workspace',
  )
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
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('migration-user-2', 'Migration User 2', 'migration-user-2@example.com', true)
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
    INSERT INTO workspaces (id, name, owner_user_id)
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other migration workspace', 'migration-user-2')
  `)
  await client.query(`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'migration-user-2', 'owner')
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
    if (migration.version === '0006') {
      await seedWorkspaceStorageQuotaUpgradeFixture(client)
    }
    if (migration.version === '0007') {
      await assertGenerationTaskLegacyReferenceGuard(client, migration.sql)
    }
    await client.query(migration.sql)
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.fileName],
    )
  }

  await assertProjectGraphSchema(client, schemaName)
  await assertAssetGovernanceSchema(client, schemaName)
  await assertWorkspaceStorageQuotaMigration(client)
  await assertGenerationTaskSchema(client, schemaName)
  await assertProviderCredentialSchema(client, schemaName)
  await assertTaskCommandSchema(client, schemaName)
  await client.query('SET CONSTRAINTS ALL IMMEDIATE')
  await client.query('ROLLBACK')
  console.log(`Checked and upgraded ${migrations.length} migration file(s) in an isolated PostgreSQL schema.`)
} finally {
  if (client.readyForQuery) {
    await client.query('ROLLBACK').catch(() => undefined)
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  }
  await client.end()
}
