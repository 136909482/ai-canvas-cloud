import { create } from 'zustand'
import type { GenerationTaskSummary } from '@ai-canvas-cloud/contracts'
import type {
  GenerateTask,
  GptImageQuality,
  ImageInputFidelity,
  ImageOperationType,
  GenerateTaskRemoteStatus,
  TaskQueueSnapshot,
  VideoGenerateNodeData,
  VideoGenerateMode,
} from '@/types'

export interface GenerateTaskSnapshot {
  projectId?: string | null
  kind?: 'image' | 'video'
  sourceNodeId: string
  previewNodeId?: string | null
  model: string
  prompt: string
  negativePrompt?: string
  ratio?: string
  resolution?: string
  operationType?: ImageOperationType
  sourceImageNodeId?: string | null
  maskImageUrl?: string | null
  apiProfileId?: string | null
  apiProfileName?: string | null
  provider?: string | null
  referenceImageUrls?: string[]
  inputFidelity?: ImageInputFidelity | null
  quality?: GptImageQuality | null
  officialFallback?: boolean
  googleSearch?: boolean
  googleImageSearch?: boolean
  videoMode?: VideoGenerateMode | null
  videoDuration?: VideoGenerateNodeData['duration'] | null
  resultImageAsset?: GenerateTask['resultImageAsset']
  resultVideoAsset?: GenerateTask['resultVideoAsset']
}

interface TaskQueueStore {
  tasks: GenerateTask[]
  cachedServerTasks: GenerateTask[]
  runtimeVersion: number
  createTask: (input: GenerateTaskSnapshot) => string
  getSnapshot: () => TaskQueueSnapshot
  replaceSnapshot: (snapshot: TaskQueueSnapshot, projectId?: string | null) => void
  resetToEmpty: () => void
  markTaskQueued: (id: string, patch?: Partial<GenerateTaskSnapshot>) => void
  markTaskRunning: (id: string, previewNodeId?: string | null) => void
  resumeRemoteTask: (id: string) => void
  attachRemoteTask: (id: string, remoteTaskId: string) => void
  setRemoteTaskStatus: (id: string, remoteStatus: GenerateTaskRemoteStatus) => void
  markTaskDone: (id: string, patch?: Partial<GenerateTaskSnapshot>) => void
  markTaskError: (id: string, errorMsg: string) => void
  markServerTaskSubmitted: (id: string, serverTask: GenerationTaskSummary) => void
  cacheServerTask: (serverTask: GenerationTaskSummary) => void
  replaceCachedServerTasks: (projectId: string, serverTasks: GenerationTaskSummary[]) => void
  restoreCachedServerTasks: (projectId: string) => void
  syncServerTask: (serverTask: GenerationTaskSummary) => void
  removeTask: (id: string) => void
  clearFinishedTasks: () => void
}

let taskIdCounter = 1

function createTaskId() {
  return `task-${taskIdCounter++}`
}

function createTaskDisplayId(seed: string) {
  let hash = 0

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(31, hash) + seed.charCodeAt(index) | 0
  }

  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8)
}

function syncTaskIdCounter(tasks: GenerateTask[]) {
  const maxTaskId = tasks.reduce((maxValue, task) => {
    const match = /^task-(\d+)$/.exec(task.id)
    const numericId = match ? Number(match[1]) : 0
    return Math.max(maxValue, numericId)
  }, 0)

  taskIdCounter = maxTaskId + 1
}

function sanitizeTask(task: GenerateTask, projectId?: string | null): GenerateTask {
  return {
    ...task,
    projectId: projectId ?? task.projectId ?? null,
    kind: task.kind === 'video' ? 'video' : 'image',
    displayId: typeof task.displayId === 'string' && task.displayId.trim()
      ? task.displayId
      : createTaskDisplayId(`${task.id}:${task.createdAt}:${task.prompt}`),
    previewNodeId: task.previewNodeId ?? null,
    negativePrompt: task.negativePrompt ?? '',
    ratio: task.ratio ?? '1:1',
    resolution: task.resolution ?? '1K',
    operationType: task.operationType ?? (task.referenceImageUrls?.length ? 'image-to-image' : 'text-to-image'),
    sourceImageNodeId: task.sourceImageNodeId ?? null,
    maskImageUrl: task.maskImageUrl ?? null,
    apiProfileId: task.apiProfileId ?? null,
    apiProfileName: task.apiProfileName ?? null,
    provider: task.provider ?? null,
    referenceImageUrls: Array.isArray(task.referenceImageUrls) ? [...task.referenceImageUrls] : [],
    inputFidelity: task.inputFidelity ?? null,
    quality: task.quality ?? null,
    officialFallback: Boolean(task.officialFallback),
    googleSearch: Boolean(task.googleSearch),
    googleImageSearch: Boolean(task.googleImageSearch),
    videoMode: task.videoMode ?? null,
    videoDuration: task.videoDuration ?? null,
    resultImageAsset: task.resultImageAsset ?? null,
    resultVideoAsset: task.resultVideoAsset ?? null,
    errorMsg: task.errorMsg ?? '',
    serverTaskId: task.serverTaskId ?? null,
    serverProgress: typeof task.serverProgress === 'number' && Number.isFinite(task.serverProgress)
      ? Math.max(0, Math.min(100, Math.round(task.serverProgress)))
      : null,
    remoteTaskId: task.remoteTaskId ?? null,
    remoteStatus: task.remoteStatus ?? null,
    finishedAt: task.finishedAt ?? null,
  }
}

function sanitizeTasks(tasks: GenerateTask[], projectId?: string | null): GenerateTask[] {
  return tasks.map((task) => sanitizeTask(task, projectId))
}

export function recoverTaskAfterSnapshotLoad(task: GenerateTask, projectId?: string | null): GenerateTask {
  const sanitizedTask = sanitizeTask(task, projectId)

  if (sanitizedTask.serverTaskId && (sanitizedTask.status === 'queued' || sanitizedTask.status === 'running')) {
    return {
      ...sanitizedTask,
      errorMsg: '',
      remoteTaskId: null,
      remoteStatus: null,
    }
  }

  if (sanitizedTask.status === 'running' && sanitizedTask.remoteTaskId) {
    return {
      ...sanitizedTask,
      errorMsg: '',
      remoteStatus: 'IN_PROGRESS',
      finishedAt: null,
    }
  }

  if (sanitizedTask.status === 'running') {
    return {
      ...sanitizedTask,
      status: 'queued',
      errorMsg: '',
      remoteTaskId: null,
      remoteStatus: null,
      startedAt: 0,
      finishedAt: null,
    }
  }

  if (sanitizedTask.status === 'queued') {
    return {
      ...sanitizedTask,
      errorMsg: '',
      remoteTaskId: null,
      remoteStatus: null,
      startedAt: 0,
      finishedAt: null,
    }
  }

  return sanitizedTask
}

export function recoverTasksAfterSnapshotLoad(tasks: GenerateTask[], projectId?: string | null): GenerateTask[] {
  return tasks.map((task) => recoverTaskAfterSnapshotLoad(task, projectId))
}

function mergeTaskSnapshot(task: GenerateTask, patch?: Partial<GenerateTaskSnapshot>): GenerateTask {
  return {
    ...task,
    projectId:
      patch && 'projectId' in patch
        ? patch.projectId ?? null
        : task.projectId ?? null,
    kind: patch?.kind ?? task.kind,
    sourceNodeId: patch?.sourceNodeId ?? task.sourceNodeId,
    previewNodeId:
      patch && 'previewNodeId' in patch
        ? patch.previewNodeId ?? null
        : task.previewNodeId,
    model: patch?.model ?? task.model,
    prompt: patch?.prompt ?? task.prompt,
    negativePrompt: patch?.negativePrompt ?? task.negativePrompt,
    ratio: patch?.ratio ?? task.ratio,
    resolution: patch?.resolution ?? task.resolution,
    operationType: patch?.operationType ?? task.operationType,
    sourceImageNodeId:
      patch && 'sourceImageNodeId' in patch
        ? patch.sourceImageNodeId ?? null
        : task.sourceImageNodeId,
    maskImageUrl:
      patch && 'maskImageUrl' in patch
        ? patch.maskImageUrl ?? null
        : task.maskImageUrl ?? null,
    apiProfileId:
      patch && 'apiProfileId' in patch
        ? patch.apiProfileId ?? null
        : task.apiProfileId ?? null,
    apiProfileName:
      patch && 'apiProfileName' in patch
        ? patch.apiProfileName ?? null
        : task.apiProfileName ?? null,
    provider:
      patch && 'provider' in patch
        ? patch.provider ?? null
        : task.provider ?? null,
    referenceImageUrls: patch?.referenceImageUrls ?? task.referenceImageUrls,
    inputFidelity:
      patch && 'inputFidelity' in patch
        ? patch.inputFidelity ?? null
        : task.inputFidelity ?? null,
    quality:
      patch && 'quality' in patch
        ? patch.quality ?? null
        : task.quality ?? null,
    officialFallback:
      patch && 'officialFallback' in patch
        ? Boolean(patch.officialFallback)
        : Boolean(task.officialFallback),
    googleSearch:
      patch && 'googleSearch' in patch
        ? Boolean(patch.googleSearch)
        : Boolean(task.googleSearch),
    googleImageSearch:
      patch && 'googleImageSearch' in patch
        ? Boolean(patch.googleImageSearch)
        : Boolean(task.googleImageSearch),
    videoMode:
      patch && 'videoMode' in patch
        ? patch.videoMode ?? null
        : task.videoMode ?? null,
    videoDuration:
      patch && 'videoDuration' in patch
        ? patch.videoDuration ?? null
        : task.videoDuration ?? null,
    resultImageAsset:
      patch && 'resultImageAsset' in patch
        ? patch.resultImageAsset ?? null
        : task.resultImageAsset ?? null,
    resultVideoAsset:
      patch && 'resultVideoAsset' in patch
        ? patch.resultVideoAsset ?? null
        : task.resultVideoAsset ?? null,
  }
}

function createServerTaskProjection(serverTask: GenerationTaskSummary): GenerateTask {
  const now = Date.now()
  return applyServerTask({
    id: `server-${serverTask.id}`,
    displayId: createTaskDisplayId(serverTask.id),
    projectId: serverTask.projectId,
    kind: serverTask.kind,
    sourceNodeId: serverTask.sourceNodeId,
    previewNodeId: serverTask.previewNodeId,
    model: serverTask.model,
    prompt: '',
    negativePrompt: '',
    ratio: '1:1',
    resolution: '1K',
    operationType: 'text-to-image',
    sourceImageNodeId: null,
    maskImageUrl: null,
    apiProfileId: null,
    apiProfileName: null,
    provider: serverTask.providerId === 'openai' || serverTask.providerId === 'aliyun' ? serverTask.providerId : null,
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
    createdAt: now,
    startedAt: 0,
    finishedAt: null,
  }, serverTask)
}

function mergeServerTaskProjection(tasks: GenerateTask[], serverTask: GenerationTaskSummary): GenerateTask[] {
  if (tasks.some((task) => task.serverTaskId === serverTask.id)) {
    return tasks.map((task) => task.serverTaskId === serverTask.id ? applyServerTask(task, serverTask) : task)
  }
  return [...tasks, createServerTaskProjection(serverTask)]
}

function mergeCachedServerTask(tasks: GenerateTask[], serverTask: GenerationTaskSummary): GenerateTask[] {
  if (serverTask.status === 'succeeded' || serverTask.status === 'failed' || serverTask.status === 'canceled') {
    return tasks.filter((task) => task.serverTaskId !== serverTask.id)
  }
  return mergeServerTaskProjection(tasks, serverTask)
}

export const useTaskQueueStore = create<TaskQueueStore>((set, get) => ({
  tasks: [],
  cachedServerTasks: [],
  runtimeVersion: 0,

  createTask: (input) => {
    const taskId = createTaskId()
    const now = Date.now()
    const displayId = createTaskDisplayId(`${taskId}:${now}:${input.prompt}`)

    set((state) => ({
      tasks: [
        ...state.tasks,
        {
          id: taskId,
          displayId,
          projectId: input.projectId ?? null,
          kind: input.kind ?? 'image',
          sourceNodeId: input.sourceNodeId,
          previewNodeId: input.previewNodeId ?? null,
          model: input.model,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt ?? '',
          ratio: input.ratio ?? '1:1',
          resolution: input.resolution ?? '1K',
          operationType: input.operationType ?? (input.referenceImageUrls?.length ? 'image-to-image' : 'text-to-image'),
          sourceImageNodeId: input.sourceImageNodeId ?? null,
          maskImageUrl: input.maskImageUrl ?? null,
          apiProfileId: input.apiProfileId ?? null,
          apiProfileName: input.apiProfileName ?? null,
          provider: input.provider ?? null,
          referenceImageUrls: input.referenceImageUrls ?? [],
          inputFidelity: input.inputFidelity ?? null,
          quality: input.quality ?? null,
          officialFallback: Boolean(input.officialFallback),
          googleSearch: Boolean(input.googleSearch),
          googleImageSearch: Boolean(input.googleImageSearch),
          videoMode: input.videoMode ?? null,
          videoDuration: input.videoDuration ?? null,
          resultImageAsset: input.resultImageAsset ?? null,
          resultVideoAsset: input.resultVideoAsset ?? null,
          status: 'queued',
          errorMsg: '',
          serverTaskId: null,
          serverProgress: null,
          remoteTaskId: null,
          remoteStatus: null,
          createdAt: now,
          startedAt: 0,
          finishedAt: null,
        },
      ],
    }))

    return taskId
  },

  getSnapshot: (): TaskQueueSnapshot => ({
    tasks: sanitizeTasks(get().tasks),
  }),

  replaceSnapshot: (snapshot, projectId) =>
    set((state) => {
      const tasks = recoverTasksAfterSnapshotLoad(sanitizeTasks(snapshot.tasks ?? [], projectId), projectId)
      syncTaskIdCounter(tasks)

      return {
        tasks,
        runtimeVersion: state.runtimeVersion + 1,
      }
    }),

  resetToEmpty: () =>
    set((state) => {
      taskIdCounter = 1
      return {
        tasks: [],
        cachedServerTasks: [],
        runtimeVersion: state.runtimeVersion + 1,
      }
    }),

  markTaskQueued: (id, patch) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...mergeTaskSnapshot(task, patch),
              status: 'queued',
              errorMsg: '',
              remoteTaskId: null,
              remoteStatus: null,
              serverTaskId: null,
              serverProgress: null,
              createdAt: Date.now(),
              startedAt: 0,
              finishedAt: null,
            }
          : task,
      ),
    })),

  markTaskRunning: (id, previewNodeId) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'running',
              previewNodeId: previewNodeId ?? task.previewNodeId,
              startedAt: Date.now(),
              finishedAt: null,
              errorMsg: '',
              remoteTaskId: null,
              remoteStatus: null,
            }
          : task,
      ),
    })),

  resumeRemoteTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'running',
              startedAt: Date.now(),
              finishedAt: null,
              errorMsg: '',
              remoteStatus: 'IN_PROGRESS',
            }
          : task,
      ),
    })),

  attachRemoteTask: (id, remoteTaskId) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              remoteTaskId,
              remoteStatus: 'IN_PROGRESS',
            }
          : task,
      ),
    })),

  setRemoteTaskStatus: (id, remoteStatus) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              remoteStatus,
            }
          : task,
      ),
    })),

  markTaskDone: (id, patch) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...mergeTaskSnapshot(task, patch),
              status: 'done',
              remoteStatus: task.remoteTaskId ? 'SUCCESS' : task.remoteStatus,
              finishedAt: Date.now(),
              errorMsg: '',
            }
          : task,
      ),
    })),

  markTaskError: (id, errorMsg) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'error',
              remoteStatus: task.remoteTaskId ? 'FAILURE' : task.remoteStatus,
              errorMsg,
              finishedAt: Date.now(),
            }
          : task,
      ),
    })),

  markServerTaskSubmitted: (id, serverTask) =>
    set((state) => ({
      tasks: state.tasks.map((task) => task.id === id ? applyServerTask(task, serverTask) : task),
      cachedServerTasks: mergeCachedServerTask(state.cachedServerTasks, serverTask),
    })),

  cacheServerTask: (serverTask) =>
    set((state) => ({
      cachedServerTasks: mergeCachedServerTask(state.cachedServerTasks, serverTask),
    })),

  replaceCachedServerTasks: (projectId, serverTasks) =>
    set((state) => ({
      cachedServerTasks: [
        ...state.cachedServerTasks.filter((task) => task.projectId !== projectId),
        ...serverTasks.map(createServerTaskProjection),
      ],
    })),

  restoreCachedServerTasks: (projectId) =>
    set((state) => {
      const cached = state.cachedServerTasks.filter((task) => task.projectId === projectId)
      if (cached.length === 0) return state
      const taskIds = new Set(cached.map((task) => task.serverTaskId))
      const retained = state.tasks.filter((task) => !task.serverTaskId || !taskIds.has(task.serverTaskId))
      return { tasks: [...retained, ...cached.map((task) => ({ ...task }))] }
    }),

  syncServerTask: (serverTask) =>
    set((state) => ({
      tasks: mergeServerTaskProjection(state.tasks, serverTask),
      cachedServerTasks: mergeCachedServerTask(state.cachedServerTasks, serverTask),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
    })),

  clearFinishedTasks: () =>
    set((state) => ({
      tasks: state.tasks.filter((task) => task.status === 'queued' || task.status === 'running'),
    })),
}))

function toTaskTimestamp(value: string | null) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function applyServerTask(task: GenerateTask, serverTask: GenerationTaskSummary): GenerateTask {
  const startedAt = toTaskTimestamp(serverTask.startedAt)
  const finishedAt = toTaskTimestamp(serverTask.finishedAt)
  const createdAt = toTaskTimestamp(serverTask.createdAt)
  const status = serverTask.status === 'succeeded'
    ? 'done'
    : serverTask.status === 'failed' || serverTask.status === 'canceled'
      ? 'error'
      : serverTask.status === 'running'
        ? 'running'
        : 'queued'
  return {
    ...task,
    projectId: serverTask.projectId,
    kind: serverTask.kind,
    previewNodeId: serverTask.previewNodeId,
    model: serverTask.model,
    serverTaskId: serverTask.id,
    serverProgress: Math.max(0, Math.min(100, Math.round(serverTask.progress))),
    status,
    errorMsg: status === 'error' ? (serverTask.errorMessage ?? '任务已取消') : '',
    remoteTaskId: null,
    remoteStatus: null,
    startedAt: startedAt ?? 0,
    finishedAt,
    createdAt: createdAt ?? task.createdAt,
  }
}
