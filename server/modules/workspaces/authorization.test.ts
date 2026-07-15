import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import { createWorkspaceAuthorizationService } from '../../dist/modules/workspaces/authorization.js'

interface QueryCall {
  text: string
  values?: unknown[]
}

function createMockPool(rows: unknown[]) {
  const calls: QueryCall[] = []

  return {
    calls,
    pool: {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values })
        return { rows }
      },
    },
  }
}

function createAccessRow(role = 'owner', status = 'active') {
  return {
    workspace_id: 'workspace-a',
    workspace_type: 'personal',
    workspace_name: 'A 的个人空间',
    workspace_status: status,
    plan_key: 'free',
    owner_user_id: 'user-a',
    member_user_id: 'user-a',
    member_role: role,
  }
}

test('workspace authorization returns access for current member', async () => {
  const { pool, calls } = createMockPool([createAccessRow()])
  const service = createWorkspaceAuthorizationService(pool as never)

  const access = await service.requireWorkspaceAccess({
    userId: 'user-a',
    workspaceId: 'workspace-a',
    allowedRoles: ['owner'],
  })

  assert.equal(access.workspace.id, 'workspace-a')
  assert.equal(access.member.role, 'owner')
  assert.deepEqual(calls[0]?.values, ['workspace-a', 'user-a'])
})

test('workspace authorization hides other users workspace existence', async () => {
  const { pool } = createMockPool([])
  const service = createWorkspaceAuthorizationService(pool as never)

  await assert.rejects(
    () => service.requireWorkspaceAccess({
      userId: 'user-b',
      workspaceId: 'workspace-a',
    }),
    (error: unknown) => error instanceof AuthServiceError
      && error.statusCode === 404
      && error.apiCode === 'RESOURCE_NOT_FOUND',
  )
})

test('workspace authorization rejects insufficient role and disabled workspace', async () => {
  const viewerService = createWorkspaceAuthorizationService(createMockPool([createAccessRow('viewer')]).pool as never)

  await assert.rejects(
    () => viewerService.requireWorkspaceAccess({
      userId: 'user-a',
      workspaceId: 'workspace-a',
      allowedRoles: ['owner', 'admin'],
    }),
    (error: unknown) => error instanceof AuthServiceError
      && error.statusCode === 403
      && error.apiCode === 'ACCESS_DENIED',
  )

  const disabledService = createWorkspaceAuthorizationService(createMockPool([createAccessRow('owner', 'disabled')]).pool as never)

  await assert.rejects(
    () => disabledService.requireWorkspaceAccess({
      userId: 'user-a',
      workspaceId: 'workspace-a',
    }),
    (error: unknown) => error instanceof AuthServiceError
      && error.statusCode === 403
      && error.apiCode === 'ACCESS_DENIED',
  )
})
