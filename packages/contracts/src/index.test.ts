import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiErrorCodes,
  createServiceUnavailableError,
  type AuthSuccessResponse,
  type CurrentWorkspaceResponse,
  type WorkspaceUsageResponse,
  type ApplyProjectGraphOperationsRequest,
  type CreateProjectCheckpointRequest,
  type ProjectCheckpointResponse,
  type ProjectRevisionRestoreResponse,
  type ProjectRevisionResponse,
  type ProjectRevisionsResponse,
  type ProjectGraphChangesResponse,
  type AssetUploadResponse,
  type AssetResponse,
  type AssetUrlResponse,
  type CompleteAssetUploadResponse,
  type CreateAssetUploadRequest,
  type CreateProjectRequest,
  type ProjectGraphResponse,
  type ProjectResponse,
  type ProjectsResponse,
  type CreateGenerationTaskRequest,
  type GenerationTaskCommandRequest,
  type GenerationTaskResponse,
  type GenerationTaskEventsResponse,
  type ProviderSettingsResponse,
} from './index.ts'

test('contracts expose stable API error codes', () => {
  assert(apiErrorCodes.includes('PROJECT_VERSION_CONFLICT'))
  assert(apiErrorCodes.includes('PROVIDER_CAPABILITY_UNSUPPORTED'))
  assert.equal(createServiceUnavailableError('req_1').error.requestId, 'req_1')
})

test('auth success response keeps user and workspace boundaries explicit', () => {
  const response: AuthSuccessResponse = {
    user: {
      id: 'user_1',
      userNumber: 10001,
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
  assert.equal(response.user.userNumber, 10001)
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

test('workspace usage contract separates stored and reserved bytes', () => {
  const response: WorkspaceUsageResponse = {
    workspaceId: 'workspace_1',
    storage: {
      usedBytes: 1024,
      reservedBytes: 512,
      totalBytes: 1536,
      quotaBytes: 20 * 1024 * 1024 * 1024,
      availableBytes: 20 * 1024 * 1024 * 1024 - 1536,
    },
    projects: [{
      projectId: '11111111-1111-4111-8111-111111111111',
      name: 'Product board',
      fileCount: 3,
      nodeCount: 8,
      storageBytes: 1024,
      archivedAt: null,
      updatedAt: '2026-07-15T00:00:00.000Z',
    }],
  }

  assert.equal(response.storage.totalBytes, response.storage.usedBytes + response.storage.reservedBytes)
  assert.equal(response.projects[0]?.fileCount, 3)
  assert.equal('userId' in response, false)
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

test('project graph changes contract exposes ordered non-tenant change batches', () => {
  const response: ProjectGraphChangesResponse = {
    projectId: 'project_1',
    version: 2,
    sequence: 2,
    after: 1,
    changes: [{
      sequence: 2,
      baseVersion: 1,
      resultVersion: 2,
      clientId: 'browser_1',
      batchId: 'batch_2',
      source: 'user',
      operations: [{ type: 'deleteNode', nodeId: 'node_1' }],
      createdAt: '2026-07-15T00:00:00.000Z',
    }],
    hasMore: false,
  }

  assert.equal(response.changes[0]?.sequence, 2)
  assert.equal('workspaceId' in response.changes[0]!, false)
  assert.equal('actorUserId' in response.changes[0]!, false)
})

test('project checkpoint contract exposes saved snapshot metadata without tenant fields', () => {
  const request: CreateProjectCheckpointRequest = {
    expectedVersion: 2,
    expectedSequence: 2,
    checkpointType: 'periodic',
  }
  const response: ProjectCheckpointResponse = {
    checkpoint: {
      id: '33333333-3333-4333-8333-333333333333',
      projectId: '11111111-1111-4111-8111-111111111111',
      projectVersion: 2,
      lastSequence: 2,
      snapshotType: 'manual',
      schemaVersion: 1,
      byteSize: 128,
      isValid: true,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
    project: {
      id: '11111111-1111-4111-8111-111111111111',
      name: '产品主视觉',
      version: 2,
      lastSequence: 2,
      nodeCount: 1,
      edgeCount: 0,
      taskCount: 0,
      archivedAt: null,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
  }

  assert.equal(request.checkpointType, 'periodic')
  assert.equal(response.checkpoint.snapshotType, 'manual')
  assert.equal('workspaceId' in response.checkpoint, false)
  assert.equal('actorUserId' in response.checkpoint, false)
})

test('project revisions contract exposes paginated checkpoint summaries', () => {
  const response: ProjectRevisionsResponse = {
    revisions: [{
      id: '33333333-3333-4333-8333-333333333333',
      projectId: '11111111-1111-4111-8111-111111111111',
      projectVersion: 2,
      lastSequence: 2,
      snapshotType: 'manual',
      schemaVersion: 1,
      byteSize: 128,
      isValid: true,
      createdAt: '2026-07-15T00:00:00.000Z',
    }],
    nextCursor: null,
  }

  assert.equal(response.revisions[0]?.lastSequence, 2)
  assert.equal('recordJson' in response.revisions[0]!, false)
})

test('project revision detail contract exposes the saved record for a version', () => {
  const response: ProjectRevisionResponse = {
    checkpoint: {
      id: '33333333-3333-4333-8333-333333333333',
      projectId: '11111111-1111-4111-8111-111111111111',
      projectVersion: 2,
      lastSequence: 2,
      snapshotType: 'manual',
      schemaVersion: 1,
      byteSize: 128,
      isValid: true,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
    record: {
      schemaVersion: 1,
      project: {
        id: '11111111-1111-4111-8111-111111111111',
        name: '产品主视觉',
        version: 2,
        lastSequence: 2,
      },
      canvas: {
        nodes: [],
        edges: [],
      },
      taskQueue: {
        tasks: [],
      },
    },
  }

  assert.equal(response.record.project.version, response.checkpoint.projectVersion)
  assert.equal('workspaceId' in response.record.project, false)
})

test('project revision restore contract exposes restore checkpoints and new project version', () => {
  const restoredCheckpoint = {
    id: '33333333-3333-4333-8333-333333333333',
    projectId: '11111111-1111-4111-8111-111111111111',
    projectVersion: 2,
    lastSequence: 2,
    snapshotType: 'manual' as const,
    schemaVersion: 1,
    byteSize: 128,
    isValid: true,
    createdAt: '2026-07-15T00:00:00.000Z',
  }
  const response: ProjectRevisionRestoreResponse = {
    restoredCheckpoint,
    preRestoreCheckpoint: {
      ...restoredCheckpoint,
      id: '44444444-4444-4444-8444-444444444444',
      projectVersion: 4,
      lastSequence: 4,
      snapshotType: 'pre_restore',
    },
    project: {
      id: '11111111-1111-4111-8111-111111111111',
      name: '产品主视觉',
      version: 5,
      lastSequence: 5,
      nodeCount: 1,
      edgeCount: 0,
      taskCount: 0,
      archivedAt: null,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T01:00:00.000Z',
    },
    version: 5,
    sequence: 5,
  }

  assert.equal(response.restoredCheckpoint.snapshotType, 'manual')
  assert.equal(response.preRestoreCheckpoint.snapshotType, 'pre_restore')
  assert.equal(response.version, response.project.version)
  assert.equal('workspaceId' in response, false)
})

test('asset upload contract keeps storage credentials out of metadata', () => {
  const request: CreateAssetUploadRequest = {
    projectId: '11111111-1111-4111-8111-111111111111',
    originalFileName: 'reference.png',
    mimeType: 'image/png',
    byteSize: 2048,
    sha256: 'a'.repeat(64),
    width: 1024,
    height: 768,
    assetKind: 'upload',
    referenceRole: 'source',
    idempotencyKey: 'asset_upload_1',
  }
  const response: AssetUploadResponse = {
    upload: {
      id: '55555555-5555-4555-8555-555555555555',
      assetId: '66666666-6666-4666-8666-666666666666',
      projectId: request.projectId!,
      originalFileName: request.originalFileName,
      expectedMimeType: request.mimeType,
      expectedByteSize: request.byteSize,
      expectedSha256: request.sha256!,
      assetKind: 'upload',
      status: 'pending',
      expiresAt: '2026-07-15T01:00:00.000Z',
      createdAt: '2026-07-15T00:00:00.000Z',
    },
    asset: {
      id: '66666666-6666-4666-8666-666666666666',
      projectId: request.projectId!,
      originalFileName: request.originalFileName,
      mimeType: request.mimeType,
      byteSize: request.byteSize,
      sha256: request.sha256!,
      width: request.width!,
      height: request.height!,
      assetKind: 'upload',
      status: 'pending',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
    directUpload: {
      method: 'PUT',
      url: 'https://object-storage.example/upload',
      headers: { 'content-type': request.mimeType },
      expiresAt: '2026-07-15T01:00:00.000Z',
    },
  }

  assert.equal(response.upload.assetId, response.asset.id)
  assert.equal('workspaceId' in response.asset, false)
  assert.equal('objectKey' in response.asset, false)
  assert.equal('accessKeyId' in response.directUpload, false)
  assert.equal('secretAccessKey' in response.directUpload, false)
})

test('asset upload completion contract returns completed metadata only', () => {
  const response: CompleteAssetUploadResponse = {
    upload: {
      id: '55555555-5555-4555-8555-555555555555',
      assetId: '66666666-6666-4666-8666-666666666666',
      projectId: '11111111-1111-4111-8111-111111111111',
      originalFileName: 'reference.png',
      expectedMimeType: 'image/png',
      expectedByteSize: 2048,
      expectedSha256: null,
      assetKind: 'upload',
      status: 'completed',
      expiresAt: '2026-07-15T01:00:00.000Z',
      createdAt: '2026-07-15T00:00:00.000Z',
    },
    asset: {
      id: '66666666-6666-4666-8666-666666666666',
      projectId: '11111111-1111-4111-8111-111111111111',
      originalFileName: 'reference.png',
      mimeType: 'image/png',
      byteSize: 2048,
      sha256: null,
      width: null,
      height: null,
      assetKind: 'upload',
      status: 'completed',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:10:00.000Z',
    },
  }

  assert.equal(response.asset.status, 'completed')
  assert.equal(response.upload.status, 'completed')
  assert.equal('objectKey' in response.asset, false)
})

test('asset read contracts expose metadata and expiring URLs without storage internals', () => {
  const metadata: AssetResponse = {
    asset: {
      id: '66666666-6666-4666-8666-666666666666',
      projectId: '11111111-1111-4111-8111-111111111111',
      originalFileName: 'reference.png',
      mimeType: 'image/png',
      byteSize: 2048,
      sha256: null,
      width: 1024,
      height: 768,
      assetKind: 'upload',
      status: 'completed',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:10:00.000Z',
    },
  }
  const read: AssetUrlResponse = {
    assetId: metadata.asset.id,
    url: 'https://object-storage.example/presigned-read',
    expiresAt: '2026-07-15T00:15:00.000Z',
  }

  assert.equal(metadata.asset.status, 'completed')
  assert.equal(read.assetId, metadata.asset.id)
  assert.equal('objectKey' in metadata.asset, false)
  assert.equal('accessKeyId' in read, false)
  assert.equal('secretAccessKey' in read, false)
})

test('generation task contracts expose resumable state without tenant or lease internals', () => {
  const request: CreateGenerationTaskRequest = {
    projectId: '11111111-1111-4111-8111-111111111111',
    sourceNodeId: 'source-node',
    previewNodeId: 'preview-node',
    kind: 'image',
    providerId: 'openai',
    model: 'gpt-image-2',
    parameters: { prompt: 'product render' },
    idempotencyKey: 'task-create-1',
  }
  const response: GenerationTaskResponse = {
    task: {
      id: '77777777-7777-4777-8777-777777777777',
      projectId: request.projectId,
      sourceNodeId: request.sourceNodeId,
      previewNodeId: request.previewNodeId ?? null,
      kind: request.kind,
      providerId: request.providerId,
      model: request.model,
      billingMode: 'workspace_key',
      status: 'queued',
      progress: 0,
      attemptCount: 0,
      maxAttempts: 3,
      errorCode: null,
      errorMessage: null,
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    },
  }
  const command: GenerationTaskCommandRequest = { idempotencyKey: 'task-cancel-1' }

  assert.equal(response.task.status, 'queued')
  assert.equal(command.idempotencyKey, 'task-cancel-1')
  assert.equal('workspaceId' in response.task, false)
  assert.equal('createdByUserId' in response.task, false)
  assert.equal('leaseOwner' in response.task, false)
  assert.equal('leaseToken' in response.task, false)
  assert.equal('remoteTaskId' in response.task, false)
})

test('generation task events expose only durable sanitized projection fields', () => {
  const response: GenerationTaskEventsResponse = {
    events: [{
      id: '88888888-8888-4888-8888-888888888888',
      taskId: '77777777-7777-4777-8777-777777777777',
      projectId: '11111111-1111-4111-8111-111111111111',
      type: 'terminal',
      status: 'failed',
      progress: 75,
      errorCode: 'PROVIDER_UNAVAILABLE',
      errorMessage: 'Provider request failed',
      createdAt: '2026-07-18T00:00:00.000Z',
    }],
    nextCursor: '42',
    hasMore: false,
  }

  assert.equal(response.events[0]?.type, 'terminal')
  assert.equal('workspaceId' in response.events[0]!, false)
  assert.equal('requestJson' in response.events[0]!, false)
  assert.equal('remoteTaskId' in response.events[0]!, false)
})

test('provider settings expose only configuration state and secret hints', () => {
  const response: ProviderSettingsResponse = {
    providers: [{
      providerId: 'openai',
      label: 'OpenAI',
      websiteUrl: 'https://openai.com',
      baseUrl: 'https://api.openai.com',
      configured: true,
      status: 'active',
      secretLastFour: '1234',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }],
  }

  assert.equal(response.providers[0]?.secretLastFour, '1234')
  assert.equal('apiKey' in response.providers[0]!, false)
  assert.equal('encryptedSecret' in response.providers[0]!, false)
  assert.equal('workspaceId' in response.providers[0]!, false)
})

function neverValue(): never {
  throw new Error('Unexpected graph operation')
}
