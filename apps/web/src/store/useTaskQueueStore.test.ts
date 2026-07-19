import { recoverTasksAfterSnapshotLoad, useTaskQueueStore } from './useTaskQueueStore.ts'
import type { GenerationTaskSummary } from '@ai-canvas-cloud/contracts'
import type { GenerateTask } from '@/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function createTask(overrides: Partial<GenerateTask>): GenerateTask {
  return {
    id: 'task-1',
    displayId: 'display-1',
    projectId: 'project-1',
    kind: 'image',
    sourceNodeId: 'gen-1',
    previewNodeId: 'preview-1',
    model: 'model-1',
    prompt: 'prompt',
    negativePrompt: '',
    ratio: '1:1',
    resolution: '1K',
    operationType: 'text-to-image',
    sourceImageNodeId: null,
    maskImageUrl: null,
    apiProfileId: null,
    apiProfileName: null,
    provider: 'openai',
    referenceImageUrls: [],
    inputFidelity: null,
    quality: null,
    officialFallback: false,
    googleSearch: false,
    googleImageSearch: false,
    videoMode: null,
    videoDuration: null,
    resultImageAsset: null,
    resultVideoAsset: null,
    status: 'queued',
    errorMsg: '',
    serverTaskId: null,
    serverProgress: null,
    remoteTaskId: null,
    remoteStatus: null,
    createdAt: 100,
    startedAt: 0,
    finishedAt: null,
    ...overrides,
  }
}

function serverTask(overrides: Partial<GenerationTaskSummary> = {}): GenerationTaskSummary {
  return {
    id: '33333333-3333-4333-8333-333333333333', projectId: 'project-1', sourceNodeId: 'gen-1', previewNodeId: 'preview-1',
    kind: 'image', providerId: 'openai', model: 'gpt-image-2', billingMode: 'workspace_key', status: 'running', progress: 65,
    attemptCount: 1, maxAttempts: 3, errorCode: null, errorMessage: null, cancelRequestedAt: null,
    startedAt: '2026-07-18T00:00:01.000Z', finishedAt: null, createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:02.000Z',
    ...overrides,
  }
}

function runTaskQueueRecoveryTests() {
  const recoveredTasks = recoverTasksAfterSnapshotLoad([
    createTask({ id: 'queued', status: 'queued', errorMsg: 'stale', remoteTaskId: 'old-remote', remoteStatus: 'IN_PROGRESS', startedAt: 200 }),
    createTask({ id: 'running-local', status: 'running', startedAt: 300 }),
    createTask({ id: 'running-remote', status: 'running', remoteTaskId: 'remote-1', remoteStatus: 'SUCCESS', startedAt: 400 }),
    createTask({ id: 'done', status: 'done', finishedAt: 500, resultImageAsset: { relativePath: 'images/a.png', mimeType: 'image/png', fileName: 'a.png' } }),
    createTask({ id: 'error', status: 'error', errorMsg: '失败', finishedAt: 600 }),
  ])

  const queuedTask = recoveredTasks.find((task) => task.id === 'queued')
  assert(queuedTask?.status === 'queued', 'queued tasks should remain queued after snapshot load')
  assert(queuedTask.remoteTaskId === null, 'queued tasks should not keep stale remote ids')
  assert(queuedTask.errorMsg === '', 'queued tasks should clear stale errors')
  assert(queuedTask.startedAt === 0, 'queued tasks should clear stale startedAt')

  const localRunningTask = recoveredTasks.find((task) => task.id === 'running-local')
  assert(localRunningTask?.status === 'queued', 'local running tasks should return to queued after refresh')
  assert(localRunningTask.startedAt === 0, 'local running tasks should clear startedAt when re-queued')

  const remoteRunningTask = recoveredTasks.find((task) => task.id === 'running-remote')
  assert(remoteRunningTask?.status === 'running', 'remote running tasks should remain running for provider polling')
  assert(remoteRunningTask.remoteTaskId === 'remote-1', 'remote running tasks should preserve remote task id')
  assert(remoteRunningTask.remoteStatus === 'IN_PROGRESS', 'remote running tasks should resume polling from an in-progress state')

  const serverRunningTask = recoverTasksAfterSnapshotLoad([
    createTask({ id: 'server-running', status: 'running', serverTaskId: '33333333-3333-4333-8333-333333333333' }),
  ])[0]
  assert(serverRunningTask?.status === 'running', 'server running tasks should remain server-owned after snapshot load')
  assert(serverRunningTask?.serverTaskId === '33333333-3333-4333-8333-333333333333', 'server task IDs should survive snapshot recovery')

  const doneTask = recoveredTasks.find((task) => task.id === 'done')
  assert(doneTask?.status === 'done', 'done tasks should remain done')
  assert(doneTask.resultImageAsset?.relativePath === 'images/a.png', 'done tasks should preserve result assets')

  const errorTask = recoveredTasks.find((task) => task.id === 'error')
  assert(errorTask?.status === 'error', 'failed tasks should remain failed')
  assert(errorTask.errorMsg === '失败', 'failed tasks should preserve error messages')

  const reassignedTask = recoverTasksAfterSnapshotLoad(
    [createTask({ projectId: 'source-project' })],
    'opened-project',
  )[0]
  assert(reassignedTask.projectId === 'opened-project', 'loaded tasks should belong to the project that contains the snapshot')

  useTaskQueueStore.setState({ tasks: [createTask({ id: 'server-local' })] })
  useTaskQueueStore.getState().markServerTaskSubmitted('server-local', serverTask())
  const projected = useTaskQueueStore.getState().tasks[0]
  assert(projected?.serverTaskId === '33333333-3333-4333-8333-333333333333', 'server task ID should be captured by the UI projection')
  assert(projected?.serverProgress === 65, 'server progress should be retained by the UI projection')
  useTaskQueueStore.getState().syncServerTask(serverTask({ status: 'succeeded', progress: 100, finishedAt: '2026-07-18T00:01:00.000Z' }))
  const completed = useTaskQueueStore.getState().tasks[0]
  assert(completed?.status === 'done' && completed.serverProgress === 100, 'terminal server summaries should update the existing projection')

  useTaskQueueStore.getState().cacheServerTask(serverTask({ id: '44444444-4444-4444-8444-444444444444', projectId: 'project-2' }))
  useTaskQueueStore.getState().replaceSnapshot({ tasks: [] }, 'project-2')
  useTaskQueueStore.getState().restoreCachedServerTasks('project-2')
  const restoredCrossProjectTask = useTaskQueueStore.getState().tasks[0]
  assert(restoredCrossProjectTask?.serverTaskId === '44444444-4444-4444-8444-444444444444', 'cached server tasks should restore when returning to their project')
  assert(restoredCrossProjectTask?.projectId === 'project-2', 'cached server tasks should not cross project boundaries')

  useTaskQueueStore.getState().replaceCachedServerTasks('project-2', [])
  assert(useTaskQueueStore.getState().cachedServerTasks.every((task) => task.projectId !== 'project-2'), 'a fresh active scan should remove terminal cross-project tasks from the cache')
}

runTaskQueueRecoveryTests()
