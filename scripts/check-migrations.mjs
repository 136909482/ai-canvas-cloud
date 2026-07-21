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
      workspace_id, task_id, attempt_number, provider_id, model_key, submission_key
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '88888888-8888-4888-8888-888888888888',
      1, 'openai', 'gpt-image-2', 'provider-submission:88888888-8888-4888-8888-888888888888'
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
    'provider_credentials_user_provider_unique',
    'provider_credentials_envelope_object_check',
    'provider_credentials_base_url_check',
    'provider_credentials_website_url_check',
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
    [schemaName, 'provider_credentials_user_status_idx'],
  )
  if (indexResult.rowCount !== 1) {
    throw new Error('Provider credential migration is missing its user status index')
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
      user_id, provider_id, base_url, encrypted_secret_json,
      key_version, secret_last_four, created_by_user_id, updated_by_user_id
    ) VALUES (
      'migration-user', 'openai', 'https://api.openai.com',
      $1::jsonb, 1, '1234', 'migration-user', 'migration-user'
    )
  `, [envelope])

  const backfilledWebsite = await client.query(`
    SELECT website_url
    FROM provider_credentials
    WHERE user_id = 'quota-upgrade-user' AND provider_id = 'openai'
  `)
  if (backfilledWebsite.rows[0]?.website_url !== 'https://openai.com') {
    throw new Error('Provider website URL migration did not backfill the known provider website')
  }

  await expectRejected(
    client,
    `UPDATE provider_credentials SET website_url = 'http://127.0.0.1' WHERE user_id = 'migration-user' AND provider_id = 'openai'`,
    [],
    'Provider credential constraint accepted a non-HTTPS website URL',
  )

  await expectRejected(
    client,
    `
      INSERT INTO provider_credentials (
        user_id, provider_id, base_url, encrypted_secret_json,
        key_version, secret_last_four, created_by_user_id, updated_by_user_id
      ) VALUES (
        'migration-user', 'aliyun', 'http://127.0.0.1',
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
        user_id, provider_id, base_url, encrypted_secret_json,
        key_version, secret_last_four, created_by_user_id, updated_by_user_id
      ) VALUES (
        'migration-user', 'aliyun',
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

async function seedAuthDeviceLegacyDedupUpgradeFixture(client) {
  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('device-dedup-user', 'Device Dedup', 'device-dedup@example.com', true)
  `)
  await client.query(`
    INSERT INTO auth_devices (user_id, device_key, user_agent, first_seen_at, last_seen_at)
    VALUES
      ('device-dedup-user', 'legacy-session:old-session', 'Same Edge Browser', now() - interval '1 day', now() - interval '1 day'),
      ('device-dedup-user', 'persistent-device-id', 'Same Edge Browser', now(), now())
  `)
}

async function assertAuthDeviceSchema(client, schemaName) {
  const tableResult = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'auth_devices'`,
    [schemaName],
  )
  if (tableResult.rowCount !== 1) {
    throw new Error('Auth device migration did not create its table')
  }

  const requiredConstraints = [
    'auth_devices_user_device_unique',
    'auth_devices_device_key_check',
    'auth_devices_user_agent_check',
    'auth_devices_seen_order_check',
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
    throw new Error('Auth device migration is missing required constraints')
  }

  const requiredIndexes = [
    'auth_devices_user_last_seen_idx',
    'auth_devices_last_session_unique_idx',
  ]
  const indexResult = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[])`,
    [schemaName, requiredIndexes],
  )
  if (indexResult.rowCount !== requiredIndexes.length) {
    throw new Error('Auth device migration is missing required indexes')
  }

  await client.query(`
    INSERT INTO "session" (id, expires_at, token, user_id, user_agent)
    VALUES (
      'migration-device-session',
      now() + interval '1 day',
      'migration-device-token',
      'migration-user',
      'Migration Browser'
    )
  `)
  await client.query(`
    INSERT INTO auth_devices (user_id, device_key, user_agent, last_session_id)
    VALUES ('migration-user', 'migration-device', 'Migration Browser', 'migration-device-session')
  `)
  await expectRejected(
    client,
    `
      INSERT INTO auth_devices (user_id, device_key)
      VALUES ('migration-user', 'migration-device')
    `,
    [],
    'Auth device migration accepted a duplicate user device key',
  )
  await client.query(`DELETE FROM "session" WHERE id = 'migration-device-session'`)
  const detached = await client.query(`
    SELECT last_session_id FROM auth_devices
    WHERE user_id = 'migration-user' AND device_key = 'migration-device'
  `)
  if (detached.rows[0]?.last_session_id !== null) {
    throw new Error('Auth device history did not survive session removal')
  }

  const deduplicated = await client.query(`
    SELECT device_key FROM auth_devices
    WHERE user_id = 'device-dedup-user' AND user_agent = 'Same Edge Browser'
  `)
  if (deduplicated.rowCount !== 1 || deduplicated.rows[0]?.device_key !== 'persistent-device-id') {
    throw new Error('Auth device legacy dedup migration did not preserve only the persistent device')
  }
}

async function seedTaskQueueOutboxUpgradeFixture(client) {
  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('outbox-upgrade-user', 'Outbox Upgrade', 'outbox-upgrade@example.com', true)
  `)
  await client.query(`
    INSERT INTO workspaces (id, name, owner_user_id)
    VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Outbox upgrade workspace', 'outbox-upgrade-user')
  `)
  await client.query(`
    INSERT INTO projects (id, workspace_id, name)
    VALUES (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Outbox upgrade project'
    )
  `)
  await client.query(`
    INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
    VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccd', 'outbox-source', 'generate', 0, 0)
  `)
  await client.query(`
    INSERT INTO generation_tasks (
      id, workspace_id, project_id, created_by_user_id, source_node_id,
      task_kind, provider_id, model_key, idempotency_key
    ) VALUES (
      'cccccccc-cccc-4ccc-8ccc-ccccccccccce',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
      'outbox-upgrade-user', 'outbox-source', 'image', 'openai',
      'gpt-image-2', 'outbox-upgrade-task'
    )
  `)
}

async function assertTaskQueueOutboxSchema(client, schemaName) {
  const tableResult = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = 'task_queue_outbox'`,
    [schemaName],
  )
  if (tableResult.rowCount !== 1) {
    throw new Error('Task queue outbox migration did not create its table')
  }
  const requiredConstraints = [
    'task_queue_outbox_workspace_task_fk',
    'task_queue_outbox_workspace_dispatch_key_unique',
    'task_queue_outbox_claim_tuple_check',
  ]
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1 AND conname = ANY($2::text[])
  `, [schemaName, requiredConstraints])
  if (constraints.rowCount !== requiredConstraints.length) {
    throw new Error('Task queue outbox migration is missing required constraints')
  }
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = $1 AND indexname = ANY($2::text[])
  `, [schemaName, ['task_queue_outbox_pending_idx', 'task_queue_outbox_task_idx']])
  if (indexes.rowCount !== 2) {
    throw new Error('Task queue outbox migration is missing required indexes')
  }
  const backfilled = await client.query(`
    SELECT dispatch_key FROM task_queue_outbox
    WHERE task_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccce'
  `)
  if (backfilled.rows[0]?.dispatch_key !== 'run:cccccccc-cccc-4ccc-8ccc-ccccccccccce:1') {
    throw new Error('Task queue outbox migration did not backfill a queued task')
  }
  await expectRejected(
    client,
    `INSERT INTO task_queue_outbox (workspace_id, task_id, dispatch_key)
     VALUES (
       'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
       'cccccccc-cccc-4ccc-8ccc-ccccccccccce',
       'run:cccccccc-cccc-4ccc-8ccc-ccccccccccce:1'
     )`,
    [],
    'Task queue outbox accepted a duplicate dispatch key',
  )
  await expectRejected(
    client,
    `INSERT INTO task_queue_outbox (workspace_id, task_id, dispatch_key)
     VALUES (
       '99999999-9999-4999-8999-999999999999',
       'cccccccc-cccc-4ccc-8ccc-ccccccccccce',
       'cross-workspace-dispatch'
     )`,
    [],
    'Task queue outbox accepted a task from another workspace',
  )
}

async function seedProviderSubmissionUpgradeFixture(client) {
  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('submission-upgrade-user', 'Submission Upgrade', 'submission-upgrade@example.com', true)
  `)
  await client.query(`
    INSERT INTO workspaces (id, name, owner_user_id)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Submission upgrade workspace', 'submission-upgrade-user')
  `)
  await client.query(`
    INSERT INTO projects (id, workspace_id, name)
    VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddde', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Submission upgrade project')
  `)
  await client.query(`
    INSERT INTO project_nodes (project_id, node_id, node_type, position_x, position_y)
    VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddde', 'submission-source', 'generate', 0, 0)
  `)
  await client.query(`
    INSERT INTO generation_tasks (
      id, workspace_id, project_id, created_by_user_id, source_node_id,
      task_kind, provider_id, model_key, idempotency_key, remote_task_id,
      status, attempt_count, lease_owner, lease_token, lease_expires_at, started_at
    ) VALUES (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddf',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
      'submission-upgrade-user', 'submission-source', 'image', 'openai',
      'gpt-image-2', 'submission-upgrade-task', 'legacy-remote-task',
      'running', 1, 'legacy-worker', gen_random_uuid(), now() + interval '5 minutes', now()
    )
  `)
  await client.query(`
    INSERT INTO task_attempts (
      workspace_id, task_id, attempt_number, provider_id, model_key
    ) VALUES (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddf', 1, 'openai', 'gpt-image-2'
    )
  `)
}

async function assertProviderSubmissionSchema(client, schemaName) {
  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'task_attempts'
      AND column_name = ANY($2::text[])
  `, [schemaName, ['submission_key', 'submission_stage', 'remote_task_id']])
  if (columns.rowCount !== 3) {
    throw new Error('Provider submission migration is missing attempt submission columns')
  }
  const requiredConstraints = [
    'task_attempts_submission_key_check',
    'task_attempts_submission_stage_check',
    'task_attempts_remote_task_id_check',
    'task_attempts_submission_remote_state_check',
  ]
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1 AND conname = ANY($2::text[])
  `, [schemaName, requiredConstraints])
  if (constraints.rowCount !== requiredConstraints.length) {
    throw new Error('Provider submission migration is missing submission constraints')
  }
  const index = await client.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = 'task_attempts_submission_recovery_idx'
  `, [schemaName])
  if (index.rowCount !== 1) {
    throw new Error('Provider submission migration is missing its recovery index')
  }
  const upgraded = await client.query(`
    SELECT submission_key, submission_stage, remote_task_id
    FROM task_attempts WHERE task_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddf'
  `)
  if (
    upgraded.rows[0]?.submission_key !== 'provider-submission:dddddddd-dddd-4ddd-8ddd-dddddddddddf'
    || upgraded.rows[0]?.submission_stage !== 'submitted'
    || upgraded.rows[0]?.remote_task_id !== 'legacy-remote-task'
  ) {
    throw new Error('Provider submission migration did not preserve an in-flight remote task')
  }
  await expectRejected(
    client,
    `UPDATE task_attempts SET submission_stage = 'invalid' WHERE task_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddf'`,
    [],
    'Provider submission migration accepted an invalid submission stage',
  )
}

async function assertGenerationTaskEventSchema(client, schemaName) {
  const table = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = 'generation_task_events'
  `, [schemaName])
  if (table.rowCount !== 1) {
    throw new Error('Generation task event migration did not create its table')
  }
  const requiredConstraints = [
    'generation_task_events_workspace_task_fk',
    'generation_task_events_workspace_project_fk',
    'generation_task_events_type_check',
    'generation_task_events_status_check',
  ]
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1 AND conname = ANY($2::text[])
  `, [schemaName, requiredConstraints])
  if (constraints.rowCount !== requiredConstraints.length) {
    throw new Error('Generation task event migration is missing tenant or event constraints')
  }
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = $1 AND indexname = ANY($2::text[])
  `, [schemaName, [
    'generation_task_events_workspace_sequence_idx',
    'generation_task_events_workspace_project_sequence_idx',
    'generation_task_events_workspace_task_sequence_idx',
  ]])
  if (indexes.rowCount !== 3) {
    throw new Error('Generation task event migration is missing polling indexes')
  }
  const backfilled = await client.query(`
    SELECT event_type, status FROM generation_task_events
    WHERE task_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccce'
  `)
  if (backfilled.rows[0]?.status !== 'queued') {
    throw new Error('Generation task event migration did not backfill an existing task')
  }
  await client.query(`
    UPDATE generation_tasks
    SET progress = 25, error_code = 'UPSTREAM', error_message = 'apiKey=must-not-leak'
    WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccce'
  `)
  const triggered = await client.query(`
    SELECT event_type, progress, error_message
    FROM generation_task_events
    WHERE task_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccce'
    ORDER BY sequence DESC LIMIT 1
  `)
  if (
    triggered.rows[0]?.event_type !== 'progress'
    || triggered.rows[0]?.progress !== 25
    || triggered.rows[0]?.error_message !== 'apiKey=[redacted]'
  ) {
    throw new Error('Generation task event trigger did not persist a sanitized projection')
  }
  await expectRejected(
    client,
    `INSERT INTO generation_task_events (
       workspace_id, task_id, project_id, event_type, status, progress
     ) VALUES (
       '99999999-9999-4999-8999-999999999999',
       'cccccccc-cccc-4ccc-8ccc-ccccccccccce',
       'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
       'status', 'queued', 0
     )`,
    [],
    'Generation task events accepted a task from another workspace',
  )
}

async function assertMigrationImportSchema(client, schemaName) {
  const table = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = 'migration_imports'
  `, [schemaName])
  if (table.rowCount !== 1) {
    throw new Error('Migration import migration did not create its table')
  }
  const requiredConstraints = [
    'migration_imports_workspace_creator_fk',
    'migration_imports_target_project_fk',
    'migration_imports_workspace_idempotency_unique',
    'migration_imports_status_check',
    'migration_imports_conflict_type_check',
    'migration_imports_conflict_target_check',
    'migration_imports_counts_nonnegative',
    'migration_imports_bytes_nonnegative',
    'migration_imports_manifest_object_check',
  ]
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1 AND conname = ANY($2::text[])
  `, [schemaName, requiredConstraints])
  if (constraints.rowCount !== requiredConstraints.length) {
    throw new Error('Migration import migration is missing tenant, lifecycle, or payload constraints')
  }
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = $1 AND indexname = ANY($2::text[])
  `, [schemaName, ['migration_imports_workspace_status_updated_idx', 'migration_imports_expiry_idx']])
  if (indexes.rowCount !== 2) {
    throw new Error('Migration import migration is missing status or expiry indexes')
  }
  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('migration-schema-user', 'Migration Schema', 'migration-schema@example.com', true)
  `)
  await client.query(`
    INSERT INTO workspaces (id, name, owner_user_id)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Migration schema workspace', 'migration-schema-user')
  `)
  await client.query(`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'migration-schema-user', 'owner')
  `)
  await client.query(`
    INSERT INTO projects (id, workspace_id, name)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Migration target')
  `)
  await client.query(`
    INSERT INTO migration_imports (
      id, workspace_id, created_by_user_id, package_schema_version, package_id,
      source_platform, source_project_id, source_project_version, source_project_sequence,
      project_name, request_fingerprint, content_sha256, idempotency_key,
      conflict_type, target_project_id, target_project_name,
      target_expected_version, target_expected_sequence,
      asset_count, total_file_count, total_bytes, estimated_storage_bytes,
      available_bytes_at_prepare, manifest_json, project_record_json, graph_json,
      asset_manifest_json, expires_at
    ) VALUES (
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'migration-schema-user', 1, 'package-schema',
      'electron', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef', 0, 0,
      'Migration package', repeat('a', 64), repeat('b', 64), 'prepare-schema',
      'project_exists', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef', 'Migration target', 0, 0,
      0, 3, 300, 0, 1000, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      now() + interval '1 hour'
    )
  `)
  await expectRejected(
    client,
    `UPDATE migration_imports SET status = 'invalid' WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'`,
    [],
    'Migration imports accepted an invalid status',
  )
  await expectRejected(
    client,
    `INSERT INTO migration_imports (
       workspace_id, created_by_user_id, package_schema_version, package_id,
       source_platform, source_project_id, source_project_version, source_project_sequence,
       project_name, request_fingerprint, content_sha256, idempotency_key,
       asset_count, total_file_count, total_bytes, estimated_storage_bytes,
       available_bytes_at_prepare, manifest_json, project_record_json, graph_json,
       asset_manifest_json, expires_at
     ) VALUES (
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'quota-upgrade-user', 1, 'cross-user',
       'web', 'legacy-project', 0, 0, 'Cross user', repeat('c', 64), repeat('d', 64),
       'cross-user', 0, 3, 0, 0, 1000, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
       '{}'::jsonb, now() + interval '1 hour'
     )`,
    [],
    'Migration imports accepted a creator outside the workspace',
  )
  await expectRejected(
    client,
    `INSERT INTO migration_imports (
       workspace_id, created_by_user_id, package_schema_version, package_id,
       source_platform, source_project_id, source_project_version, source_project_sequence,
       project_name, request_fingerprint, content_sha256, idempotency_key,
       asset_count, total_file_count, total_bytes, estimated_storage_bytes,
       available_bytes_at_prepare, manifest_json, project_record_json, graph_json,
       asset_manifest_json, expires_at
     ) VALUES (
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'migration-schema-user', 1, 'duplicate-key',
       'web', 'legacy-project', 0, 0, 'Duplicate key', repeat('e', 64), repeat('f', 64),
       'prepare-schema', 0, 3, 0, 0, 1000, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
       '{}'::jsonb, now() + interval '1 hour'
     )`,
    [],
    'Migration imports accepted a duplicate workspace idempotency key',
  )
}

async function assertMigrationAssetUploadSchema(client, schemaName) {
  const table = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = 'migration_import_asset_uploads'
  `, [schemaName])
  if (table.rowCount !== 1) {
    throw new Error('Migration asset upload migration did not create its table')
  }
  const requiredConstraints = [
    'migration_import_asset_uploads_workspace_import_fk',
    'migration_import_asset_uploads_logical_unique',
    'migration_import_asset_uploads_object_key_unique',
    'migration_import_asset_uploads_mode_parts_check',
    'migration_import_asset_uploads_status_check',
    'migration_import_asset_uploads_completed_parts_json_check',
    'migration_import_asset_uploads_byte_size_check',
    'migration_import_asset_uploads_error_state_check',
  ]
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1 AND conname = ANY($2::text[])
  `, [schemaName, requiredConstraints])
  if (constraints.rowCount !== requiredConstraints.length) {
    throw new Error('Migration asset upload migration is missing lifecycle, tenant, or payload constraints')
  }
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = $1 AND indexname = ANY($2::text[])
  `, [schemaName, ['migration_import_asset_uploads_import_status_idx', 'migration_import_asset_uploads_expiry_idx']])
  if (indexes.rowCount !== 2) {
    throw new Error('Migration asset upload migration is missing status or expiry indexes')
  }
  await client.query(`
    INSERT INTO migration_import_asset_uploads (
      id, workspace_id, import_id, logical_asset_id, object_key, provider_upload_id,
      upload_mode, part_size, part_count, completed_parts_json, expected_file_path,
      expected_original_file_name, expected_mime_type, expected_byte_size, expected_sha256,
      expected_asset_kind, status, expires_at
    ) VALUES (
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      'schema-asset', 'workspaces/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/migration-imports/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/schema-asset.png',
      'provider-upload-1', 'multipart', 8, 2,
      '[{"partNumber":1,"etag":"etag-1","byteSize":8}]'::jsonb,
      'assets/schema-asset.png', 'schema.png', 'image/png', 16, repeat('a', 64), 'upload', 'uploading',
      now() + interval '1 hour'
    )
  `)
  await expectRejected(
    client,
    `UPDATE migration_import_asset_uploads SET status = 'invalid' WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'`,
    [],
    'Migration asset uploads accepted an invalid status',
  )
  await expectRejected(
    client,
    `INSERT INTO migration_import_asset_uploads (
       workspace_id, import_id, logical_asset_id, object_key, upload_mode, part_size, part_count,
       expected_file_path, expected_mime_type, expected_byte_size, expected_sha256, expected_asset_kind, expires_at
     ) VALUES (
       'ffffffff-ffff-4fff-8fff-ffffffffffff',
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'cross-workspace',
       'workspaces/ffffffff-ffff-4fff-8fff-ffffffffffff/migration-imports/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/cross.png',
       'single', 8, 1, 'assets/cross.png', 'image/png', 8, repeat('b', 64), 'upload', now() + interval '1 hour'
     )`,
    [],
    'Migration asset uploads accepted a cross-workspace import',
  )
}

async function assertMigrationCommitSchema(client, schemaName) {
  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'migration_imports'
      AND column_name = ANY($2::text[])
  `, [schemaName, ['commit_idempotency_key', 'commit_request_fingerprint', 'commit_strategy', 'committed_project_id', 'committed_at']])
  if (columns.rowCount !== 5) {
    throw new Error('Migration commit migration is missing commit idempotency columns')
  }
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1 AND conname = ANY($2::text[])
  `, [schemaName, [
    'migration_imports_commit_key_check',
    'migration_imports_commit_fingerprint_check',
    'migration_imports_commit_strategy_check',
    'migration_imports_commit_state_check',
    'migration_import_asset_uploads_committed_asset_fk',
  ]])
  if (constraints.rowCount !== 5) {
    throw new Error('Migration commit migration is missing commit state constraints')
  }
  await expectRejected(
    client,
    `UPDATE migration_imports SET status = 'completed' WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'`,
    [],
    'Migration imports accepted a completed row without commit metadata',
  )
}

async function assertMigrationExportSchema(client, schemaName) {
  const table = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = 'migration_exports'
  `, [schemaName])
  if (table.rowCount !== 1) {
    throw new Error('Migration export migration did not create migration_exports')
  }
  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'migration_exports' AND column_name = 'retry_count'
  `, [schemaName])
  if (columns.rowCount !== 1) {
    throw new Error('Migration lifecycle retry migration is missing export retry_count')
  }
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1 AND conname = ANY($2::text[])
  `, [schemaName, [
    'migration_exports_workspace_idempotency_unique',
    'migration_exports_workspace_project_fk',
    'migration_exports_creator_fk',
    'migration_exports_status_check',
    'migration_exports_versions_nonnegative',
    'migration_exports_counts_nonnegative',
    'migration_exports_payload_object_check',
    'migration_exports_archive_state_check',
    'migration_exports_retry_count_check',
  ]])
  if (constraints.rowCount !== 9) {
    throw new Error('Migration export migration is missing lifecycle or tenant constraints')
  }
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = $1 AND indexname = ANY($2::text[])
  `, [schemaName, ['migration_exports_workspace_status_updated_idx', 'migration_exports_expiry_idx', 'migration_exports_retryable_idx']])
  if (indexes.rowCount !== 3) {
    throw new Error('Migration export migration is missing lifecycle indexes')
  }
}

async function seedUserNumberUpgradeFixture(client) {
  await client.query(`
    INSERT INTO "user" (id, name, email, created_at, updated_at)
    VALUES
      ('user-number-a', 'User Number A', 'user-number-a@example.invalid', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('user-number-b', 'User Number B', 'user-number-b@example.invalid', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
  `)
}

async function seedProviderWebsiteUpgradeFixture(client) {
  await client.query(`
    INSERT INTO provider_credentials (
      user_id, provider_id, display_name, provider_type, base_url, encrypted_secret_json,
      key_version, secret_last_four, status, created_by_user_id, updated_by_user_id
    ) VALUES (
      'quota-upgrade-user', 'openai', 'OpenAI', 'openai_compatible', 'https://api.openai.com',
      '{"algorithm":"aes-256-gcm","keyVersion":1,"iv":"website-iv","ciphertext":"website-ciphertext","authTag":"website-auth-tag"}'::jsonb,
      1, '1234', 'active', 'quota-upgrade-user', 'quota-upgrade-user'
    )
  `)
}

async function assertUserNumberSchema(client, schemaName) {
  const users = await client.query(`
    SELECT id, user_no
    FROM "user"
    WHERE id IN ('user-number-a', 'user-number-b')
    ORDER BY created_at ASC, id ASC
  `)
  if (users.rows.length !== 2
    || Number(users.rows[0]?.user_no) !== 10001
    || Number(users.rows[1]?.user_no) !== 10002) {
    throw new Error('User number migration did not backfill stable sequential numbers')
  }

  const maximumBeforeInsert = await client.query('SELECT max(user_no) AS maximum FROM "user"')
  const expectedNextNumber = Number(maximumBeforeInsert.rows[0]?.maximum) + 1
  const inserted = await client.query(`
    INSERT INTO "user" (id, name, email)
    VALUES ('user-number-c', 'User Number C', 'user-number-c@example.invalid')
    RETURNING user_no
  `)
  if (Number(inserted.rows[0]?.user_no) !== expectedNextNumber) {
    throw new Error('User number sequence did not continue after the backfill maximum')
  }

  const constraints = await client.query(`
    SELECT conname
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = $1
      AND conname = ANY($2::text[])
  `, [schemaName, ['user_user_no_unique', 'user_user_no_check']])
  if (constraints.rowCount !== 2) {
    throw new Error('User number migration is missing uniqueness or range constraints')
  }

  await expectRejected(
    client,
    `UPDATE "user" SET user_no = 10000 WHERE id = 'user-number-c'`,
    [],
    'User number migration accepted a number below 10001',
  )
  await expectRejected(
    client,
    `UPDATE "user" SET user_no = 10001 WHERE id = 'user-number-c'`,
    [],
    'User number migration accepted a duplicate number',
  )
}

async function assertAdminSecuritySchema(client) {
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'admin'
      AND table_name = ANY($1::text[])
  `, [['user', 'session', 'account', 'verification', 'two_factor', 'audit_events']])
  if (tables.rowCount !== 6) {
    throw new Error('Admin security migration did not create all isolated tables')
  }
  const publicUsage = await client.query(`SELECT has_schema_privilege('public', 'admin', 'USAGE') AS allowed`)
  if (publicUsage.rows[0]?.allowed !== false) {
    throw new Error('Admin schema is accessible through PUBLIC privileges')
  }
  const administratorId = `migration-admin-${randomUUID()}`
  const auditId = randomUUID()
  await client.query(`
    INSERT INTO admin."user" (id, name, email, role)
    VALUES ($1, 'Migration Admin', $2, 'auditor')
  `, [administratorId, `${administratorId}@example.invalid`])
  await client.query(`
    INSERT INTO admin.audit_events (id, admin_user_id, admin_role, action, result, request_id)
    VALUES ($1, $2, 'auditor', 'migration.admin_schema.checked', 'success', $3)
  `, [auditId, administratorId, `migration-${auditId}`])
  await expectRejected(
    client,
    'UPDATE admin.audit_events SET result = \'failure\' WHERE id = $1',
    [auditId],
    'Admin audit events accepted an UPDATE',
  )
  await expectRejected(
    client,
    'DELETE FROM admin.audit_events WHERE id = $1',
    [auditId],
    'Admin audit events accepted a DELETE',
  )
}

readDotEnv()
const migrations = loadMigrations()
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('Missing MIGRATION_DATABASE_URL or DATABASE_URL. Migration tests require a disposable PostgreSQL schema.')
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
    if (migration.version === '0011') {
      await seedAuthDeviceLegacyDedupUpgradeFixture(client)
    }
    if (migration.version === '0012') {
      await seedTaskQueueOutboxUpgradeFixture(client)
    }
    if (migration.version === '0013') {
      await seedProviderSubmissionUpgradeFixture(client)
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    }
    if (migration.version === '0023') {
      await seedUserNumberUpgradeFixture(client)
    }
    if (migration.version === '0024') {
      await seedProviderWebsiteUpgradeFixture(client)
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
  await assertAuthDeviceSchema(client, schemaName)
  await assertTaskQueueOutboxSchema(client, schemaName)
  await assertProviderSubmissionSchema(client, schemaName)
  await assertGenerationTaskEventSchema(client, schemaName)
  await assertMigrationImportSchema(client, schemaName)
  await assertMigrationAssetUploadSchema(client, schemaName)
  await assertMigrationCommitSchema(client, schemaName)
  await assertMigrationExportSchema(client, schemaName)
  await assertUserNumberSchema(client, schemaName)
  await assertAdminSecuritySchema(client)
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
