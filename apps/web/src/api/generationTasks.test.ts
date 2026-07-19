import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCloudGenerationTaskRequest, createCloudGenerationTaskApi } from './generationTasks.ts'
import type { GenerateTask } from '@/types'

function task(overrides: Partial<GenerateTask> = {}): GenerateTask {
  return {
    id: 'local-task', displayId: 'local-task', projectId: '11111111-1111-4111-8111-111111111111',
    kind: 'image', sourceNodeId: 'source', previewNodeId: 'preview', model: 'gpt-image-2', prompt: 'draw a lake',
    negativePrompt: '', ratio: '1:1', resolution: '1K', operationType: 'text-to-image', sourceImageNodeId: null,
    maskImageUrl: null, apiProfileId: null, apiProfileName: null, provider: 'openai', referenceImageUrls: [],
    inputFidelity: null, quality: 'high', officialFallback: false, googleSearch: false, googleImageSearch: false,
    videoMode: null, videoDuration: null, resultImageAsset: null, resultVideoAsset: null,
    status: 'queued', errorMsg: '', serverTaskId: null, remoteTaskId: null, remoteStatus: null,
    createdAt: 1, startedAt: 0, finishedAt: null,
    ...overrides,
  }
}

test('cloud generation task requests do not contain browser credentials or URLs', () => {
  assert.deepEqual(buildCloudGenerationTaskRequest(task()), {
    projectId: '11111111-1111-4111-8111-111111111111', sourceNodeId: 'source', previewNodeId: 'preview',
    kind: 'image', providerId: 'openai', model: 'gpt-image-2',
    parameters: { prompt: 'draw a lake', operationType: 'text-to-image', quality: 'high' },
    idempotencyKey: 'cloud-task:11111111-1111-4111-8111-111111111111:local-task',
  })
  assert.deepEqual(buildCloudGenerationTaskRequest(task({
    kind: 'video', provider: 'aliyun', model: 'wan2.7-t2v', resolution: '720p', ratio: '16:9', videoDuration: '10s',
  })).parameters, { prompt: 'draw a lake', resolution: '720P', ratio: '16:9', duration: '10s' })
  assert.deepEqual(buildCloudGenerationTaskRequest(task({
    operationType: 'image-edit', sourceImageNodeId: 'asset-source', maskImageUrl: 'https://must-not-send.example/mask.png',
  })).sourceNodeId, 'asset-source')
})

test('cloud generation task client pages project task summaries through fixed API paths', async () => {
  const paths: string[] = []
  const api = createCloudGenerationTaskApi(async <TResponse>(path: string) => {
    paths.push(path)
    return (paths.length === 1
      ? { tasks: [{ id: 'task-a' }], nextCursor: 'cursor-a' }
      : { tasks: [{ id: 'task-b' }], nextCursor: null }) as TResponse
  })
  const tasks = await api.listProject('project-a')
  assert.deepEqual(tasks, [{ id: 'task-a' }, { id: 'task-b' }])
  assert.deepEqual(paths, [
    '/tasks?projectId=project-a&limit=100',
    '/tasks?projectId=project-a&limit=100&cursor=cursor-a',
  ])
})

test('cloud generation task client limits background project scans to active task states', async () => {
  const paths: string[] = []
  const api = createCloudGenerationTaskApi(async <TResponse>(path: string) => {
    paths.push(path)
    return { tasks: [], nextCursor: null } as TResponse
  })

  await api.listActiveProject('project-a')

  assert.deepEqual(paths.sort(), [
    '/tasks?projectId=project-a&limit=100&status=queued',
    '/tasks?projectId=project-a&limit=100&status=running',
  ])
})

test('cloud generation task client resumes event polling from the last durable cursor', async () => {
  const paths: string[] = []
  const api = createCloudGenerationTaskApi(async <TResponse>(path: string) => {
    paths.push(path)
    return (paths.length === 1
      ? { events: [{ id: 'event-a' }], nextCursor: '12', hasMore: true }
      : { events: [{ id: 'event-b' }], nextCursor: '13', hasMore: false }) as TResponse
  })

  assert.deepEqual(await api.listEvents('project-a', '10'), {
    events: [{ id: 'event-a' }, { id: 'event-b' }],
    cursor: '13',
  })
  assert.deepEqual(paths, [
    '/tasks/events?projectId=project-a&limit=100&after=10',
    '/tasks/events?projectId=project-a&limit=100&after=12',
  ])
})
