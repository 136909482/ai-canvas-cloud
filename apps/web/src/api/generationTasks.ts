import type {
  CreateGenerationTaskRequest,
  GenerationTaskCommandRequest,
  GenerationTaskEventsResponse,
  GenerationTaskResponse,
  GenerationTasksResponse,
} from '@ai-canvas-cloud/contracts'
import type { GenerateTask } from '@/types'
import { requestCloudJson } from './cloudApiClient.ts'

export const CLOUD_TASK_POLL_INTERVAL_MS = 3_000

type CloudRequest = <TResponse>(path: string, options?: RequestInit) => Promise<TResponse>

function requireCloudProvider(task: GenerateTask) {
  if (!task.provider?.trim()) {
    throw new Error('Cloud task requires a configured supported Provider')
  }
  return task.provider
}

function buildTaskParameters(task: GenerateTask, providerId: string) {
  if (task.kind === 'video') {
    return {
      prompt: task.prompt,
      resolution: task.resolution.toUpperCase(),
      ratio: task.ratio,
      duration: task.videoDuration ?? '5s',
    }
  }
  return {
    prompt: task.prompt,
    operationType: task.operationType,
    ...(providerId === 'aliyun' && task.negativePrompt ? { negativePrompt: task.negativePrompt } : {}),
    ...(providerId !== 'aliyun' && task.quality ? { quality: task.quality } : {}),
  }
}

export function buildCloudGenerationTaskRequest(task: GenerateTask): CreateGenerationTaskRequest {
  if (!task.projectId) {
    throw new Error('Cloud task requires a project ID')
  }
  const providerId = requireCloudProvider(task)
  const sourceNodeId = task.operationType === 'image-edit'
    ? task.sourceImageNodeId ?? task.sourceNodeId
    : task.sourceNodeId
  return {
    projectId: task.projectId,
    sourceNodeId,
    previewNodeId: task.previewNodeId,
    kind: task.kind,
    providerId,
    model: task.model,
    parameters: buildTaskParameters(task, providerId),
    idempotencyKey: `cloud-task:${task.projectId}:${task.id}`,
  }
}

export function createCloudGenerationTaskApi(request: CloudRequest = requestCloudJson) {
  const listProjectTasks = async (projectId: string, status?: 'queued' | 'running') => {
    const tasks = [] as GenerationTasksResponse['tasks']
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({ projectId, limit: '100' })
      if (status) query.set('status', status)
      if (cursor) query.set('cursor', cursor)
      const response = await request<GenerationTasksResponse>(`/tasks?${query.toString()}`)
      tasks.push(...response.tasks)
      cursor = response.nextCursor
    } while (cursor)
    return tasks
  }

  return {
    create(task: GenerateTask) {
      return request<GenerationTaskResponse>('/tasks', {
        method: 'POST',
        body: JSON.stringify(buildCloudGenerationTaskRequest(task)),
      })
    },

    listProject(projectId: string) {
      return listProjectTasks(projectId)
    },

    async listActiveProject(projectId: string) {
      const [queued, running] = await Promise.all([
        listProjectTasks(projectId, 'queued'),
        listProjectTasks(projectId, 'running'),
      ])
      return [...queued, ...running]
    },

    async listEvents(projectId: string, after?: string | null) {
      const events: GenerationTaskEventsResponse['events'] = []
      let cursor = after ?? null
      let hasMore = false
      do {
        const query = new URLSearchParams({ projectId, limit: '100' })
        if (cursor) query.set('after', cursor)
        const response = await request<GenerationTaskEventsResponse>(`/tasks/events?${query.toString()}`)
        events.push(...response.events)
        cursor = response.nextCursor
        hasMore = response.hasMore
      } while (hasMore)
      return { events, cursor }
    },

    get(taskId: string) {
      return request<GenerationTaskResponse>(`/tasks/${encodeURIComponent(taskId)}`)
    },

    cancel(taskId: string, idempotencyKey: string) {
      const body: GenerationTaskCommandRequest = { idempotencyKey }
      return request<GenerationTaskResponse>(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST', body: JSON.stringify(body),
      })
    },

    retry(taskId: string, idempotencyKey: string) {
      const body: GenerationTaskCommandRequest = { idempotencyKey }
      return request<GenerationTaskResponse>(`/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: 'POST', body: JSON.stringify(body),
      })
    },
  }
}

export const cloudGenerationTaskApi = createCloudGenerationTaskApi()
