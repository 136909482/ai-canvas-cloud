import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiErrorCodes,
  createServiceUnavailableError,
  type AuthSuccessResponse,
  type CurrentWorkspaceResponse,
  type ApplyProjectGraphOperationsRequest,
  type CreateProjectRequest,
  type ProjectGraphResponse,
  type ProjectResponse,
  type ProjectsResponse,
} from './index.ts'

test('contracts expose stable API error codes', () => {
  assert(apiErrorCodes.includes('PROJECT_VERSION_CONFLICT'))
  assert.equal(createServiceUnavailableError('req_1').error.requestId, 'req_1')
})

test('auth success response keeps user and workspace boundaries explicit', () => {
  const response: AuthSuccessResponse = {
    user: {
      id: 'user_1',
      email: 'artist@example.com',
      status: 'active',
      emailVerified: true,
    },
    workspace: {
      id: 'workspace_1',
      type: 'personal',
      name: 'artist 的个人空间',
      role: 'owner',
      status: 'active',
      planKey: 'free',
    },
    session: {
      expiresAt: '2026-08-14T00:00:00.000Z',
    },
  }

  assert.equal(response.workspace.role, 'owner')
  assert.equal(response.user.email, 'artist@example.com')
})

test('current workspace response wraps the authorized workspace summary', () => {
  const response: CurrentWorkspaceResponse = {
    workspace: {
      id: 'workspace_1',
      type: 'personal',
      name: 'artist 的个人空间',
      role: 'owner',
      status: 'active',
      planKey: 'free',
    },
  }

  assert.equal(response.workspace.status, 'active')
})

test('project contracts expose only tenant-safe project metadata', () => {
  const createRequest: CreateProjectRequest = {
    id: '11111111-1111-4111-8111-111111111111',
    name: '产品主视觉',
  }
  const project: ProjectResponse['project'] = {
    id: createRequest.id!,
    name: createRequest.name,
    version: 0,
    lastSequence: 0,
    nodeCount: 0,
    edgeCount: 0,
    taskCount: 0,
    archivedAt: null,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
  const response: ProjectsResponse = {
    projects: [project],
    nextCursor: null,
  }

  assert.equal(response.projects[0]?.name, '产品主视觉')
  assert.equal('workspaceId' in project, false)
})

test('project graph contracts keep versioned operations explicit', () => {
  const request: ApplyProjectGraphOperationsRequest = {
    baseVersion: 0,
    clientId: 'browser_1',
    batchId: 'batch_1',
    idempotencyKey: 'graph_1',
    operations: [{
      type: 'upsertNode',
      node: {
        id: 'node_1',
        nodeType: 'text',
        position: { x: 10, y: 20 },
        dataSchemaVersion: 1,
        data: {},
      },
    }],
  }
  const graph: ProjectGraphResponse = {
    projectId: 'project_1',
    version: 1,
    sequence: 1,
    nodes: [request.operations[0]!.type === 'upsertNode' ? request.operations[0]!.node : neverValue()],
    edges: [],
  }

  assert.equal(graph.nodes[0]?.id, 'node_1')
})

function neverValue(): never {
  throw new Error('Unexpected graph operation')
}
