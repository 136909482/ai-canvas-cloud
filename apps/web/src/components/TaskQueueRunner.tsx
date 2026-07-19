import { useEffect, useMemo, useRef } from 'react'
import type { GenerationTaskEvent } from '@ai-canvas-cloud/contracts'
import { cloudGenerationTaskApi, CLOUD_TASK_POLL_INTERVAL_MS } from '@/api/generationTasks'
import { runGenerateTask } from '@/features/generateQueue/orchestrator'
import { platformRuntime } from '@/platform'
import { useCanvasStore } from '@/store/useCanvasStore'
import { useProjectStore } from '@/store/useProjectStore'
import { useNotificationStore } from '@/store/useNotificationStore'
import { useTaskQueueStore } from '@/store/useTaskQueueStore'
import type { GenerateTask } from '@/types'

const IMAGE_TASK_LANE_KEY = 'image-parallel'
const IMAGE_TASK_LANE_LIMIT = 8
const VIDEO_TASK_LANE_KEY = 'video-serial'
const VIDEO_TASK_LANE_LIMIT = 1

function getTaskLane(task: GenerateTask) {
  if (task.kind === 'video') {
    return {
      key: VIDEO_TASK_LANE_KEY,
      limit: VIDEO_TASK_LANE_LIMIT,
    }
  }

  return {
    key: IMAGE_TASK_LANE_KEY,
    limit: IMAGE_TASK_LANE_LIMIT,
  }
}

function syncCloudTaskNodeState(task: GenerateTask) {
  const status = task.status === 'running'
    ? 'generating'
    : task.status === 'done'
      ? 'done'
      : task.status === 'error'
        ? 'error'
        : 'queued'
  const canvas = useCanvasStore.getState()
  canvas.updateNodeData(task.sourceNodeId, { status, errorMsg: task.errorMsg })
  if (task.previewNodeId) {
    canvas.updateNodeData(task.previewNodeId, {
      status,
      errorMsg: task.errorMsg,
      ...(task.kind === 'image' ? { taskId: task.serverTaskId ?? task.id } : {}),
    })
  }
}

async function submitCloudTask(localTaskId: string) {
  const taskStore = useTaskQueueStore.getState()
  const task = taskStore.tasks.find((item) => item.id === localTaskId)
  if (!task || task.serverTaskId || task.status !== 'queued') return
  try {
    const response = await cloudGenerationTaskApi.create(task)
    taskStore.markServerTaskSubmitted(task.id, response.task)
    const projected = useTaskQueueStore.getState().tasks.find((item) => item.id === task.id)
    if (projected) syncCloudTaskNodeState(projected)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    taskStore.markTaskError(task.id, message)
    const failed = useTaskQueueStore.getState().tasks.find((item) => item.id === task.id)
    if (failed) syncCloudTaskNodeState(failed)
  }
}

async function refreshCloudTaskProjection(projectId: string) {
  const summaries = await cloudGenerationTaskApi.listProject(projectId)
  let hasNewTerminalTask = false
  for (const summary of summaries) {
    const before = useTaskQueueStore.getState().tasks.find((task) => task.serverTaskId === summary.id)
    const wasTerminal = before?.status === 'done' || before?.status === 'error'
    useTaskQueueStore.getState().syncServerTask(summary)
    const projected = useTaskQueueStore.getState().tasks.find((task) => task.serverTaskId === summary.id)
    if (projected) {
      syncCloudTaskNodeState(projected)
      if (!wasTerminal && (projected.status === 'done' || projected.status === 'error')) {
        hasNewTerminalTask = true
      }
    }
  }
  if (hasNewTerminalTask) {
    await useProjectStore.getState().reloadFromWorkspace()
  }
}

async function refreshCloudTaskCache(projectId: string) {
  const summaries = await cloudGenerationTaskApi.listActiveProject(projectId)
  useTaskQueueStore.getState().replaceCachedServerTasks(projectId, summaries)
}

function notifyTerminalTaskEvent(event: GenerationTaskEvent) {
  if (event.type !== 'terminal') return
  const projectName = useProjectStore.getState().projects.find((project) => project.id === event.projectId)?.name
  const projectLabel = projectName ? `项目「${projectName}」` : '项目'
  const notification = event.status === 'failed'
    ? {
        kind: 'error' as const,
        level: 'error' as const,
        title: '生成任务失败',
        message: event.errorMessage ?? `${projectLabel}的生成任务未完成。`,
      }
    : event.status === 'canceled'
      ? {
          kind: 'system' as const,
          level: 'info' as const,
          title: '生成任务已取消',
          message: `${projectLabel}的生成任务已取消。`,
        }
      : {
          kind: 'system' as const,
          level: 'info' as const,
          title: '生成任务已完成',
          message: `${projectLabel}的生成任务已完成。`,
        }
  useNotificationStore.getState().push({
    ...notification,
    createdAt: event.createdAt,
    dedupeKey: `task-event:${event.id}`,
  })
}

async function refreshCloudTaskEvents(projectId: string, after: string | null) {
  const response = await cloudGenerationTaskApi.listEvents(projectId, after)
  response.events.forEach(notifyTerminalTaskEvent)
  return response.cursor
}

export function TaskQueueRunner() {
  const tasks = useTaskQueueStore((s) => s.tasks)
  const taskQueueRuntimeVersion = useTaskQueueStore((s) => s.runtimeVersion)
  const isProjectReady = useProjectStore((s) => s.isReady)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projectIds = useProjectStore((s) => s.projects
    .filter((project) => !project.archivedAt)
    .map((project) => project.id)
    .join('\u0000'))
  const inFlightTaskIdsRef = useRef<Set<string>>(new Set())
  const eventCursorByProjectRef = useRef<Map<string, string | null>>(new Map())
  const backgroundProjectCursorRef = useRef(0)
  const runningTasks = useMemo(
    () => tasks.filter((task) => task.status === 'running'),
    [tasks],
  )
  const nextQueuedTasks = useMemo(
    () =>
      [...tasks]
        .filter((task) => task.status === 'queued')
        .sort((left, right) => left.createdAt - right.createdAt),
    [tasks],
  )

  useEffect(() => {
    inFlightTaskIdsRef.current.clear()
  }, [taskQueueRuntimeVersion])

  useEffect(() => {
    if (platformRuntime !== 'cloud' || !isProjectReady || !activeProjectId) return
    let disposed = false
    let inFlight = false
    const refresh = () => {
      if (disposed || inFlight) return
      inFlight = true
      useTaskQueueStore.getState().restoreCachedServerTasks(activeProjectId)
      for (const task of useTaskQueueStore.getState().tasks) {
        if (task.projectId === activeProjectId && task.serverTaskId) {
          syncCloudTaskNodeState(task)
        }
      }
      void Promise.all([
        refreshCloudTaskProjection(activeProjectId),
        refreshCloudTaskEvents(
          activeProjectId,
          eventCursorByProjectRef.current.get(activeProjectId) ?? null,
        ).then((cursor) => eventCursorByProjectRef.current.set(activeProjectId, cursor)),
      ])
        .catch(() => undefined)
        .finally(() => { inFlight = false })
    }
    refresh()
    const timer = window.setInterval(refresh, CLOUD_TASK_POLL_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeProjectId, isProjectReady])

  useEffect(() => {
    if (platformRuntime !== 'cloud' || !isProjectReady) return
    const candidates = projectIds.split('\u0000').filter((projectId) => projectId && projectId !== activeProjectId)
    if (candidates.length === 0) return
    let disposed = false
    let inFlight = false
    const refreshNext = () => {
      if (disposed || inFlight) return
      const projectId = candidates[backgroundProjectCursorRef.current % candidates.length]
      backgroundProjectCursorRef.current += 1
      if (!projectId) return
      inFlight = true
      void Promise.all([
        refreshCloudTaskCache(projectId),
        refreshCloudTaskEvents(
          projectId,
          eventCursorByProjectRef.current.get(projectId) ?? null,
        ).then((cursor) => eventCursorByProjectRef.current.set(projectId, cursor)),
      ])
        .catch(() => undefined)
        .finally(() => { inFlight = false })
    }
    refreshNext()
    const timer = window.setInterval(refreshNext, CLOUD_TASK_POLL_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeProjectId, isProjectReady, projectIds])

  useEffect(() => {
    if (!isProjectReady) {
      return
    }

    if (platformRuntime === 'cloud') {
      for (const task of nextQueuedTasks) {
        if (!task.serverTaskId && !inFlightTaskIdsRef.current.has(task.id)) {
          inFlightTaskIdsRef.current.add(task.id)
          void submitCloudTask(task.id).finally(() => inFlightTaskIdsRef.current.delete(task.id))
        }
      }
      return
    }

    if (nextQueuedTasks.length === 0) {
      return
    }

    const laneUsage = new Map<string, number>()

    for (const task of runningTasks) {
      const lane = getTaskLane(task)
      laneUsage.set(lane.key, (laneUsage.get(lane.key) ?? 0) + 1)
    }

    const launchableTasks = nextQueuedTasks.filter((task) => {
      if (inFlightTaskIdsRef.current.has(task.id)) {
        return false
      }

      const lane = getTaskLane(task)
      const currentUsage = laneUsage.get(lane.key) ?? 0

      if (currentUsage >= lane.limit) {
        return false
      }

      laneUsage.set(lane.key, currentUsage + 1)
      return true
    })

    if (launchableTasks.length === 0) {
      return
    }

    for (const task of launchableTasks) {
      inFlightTaskIdsRef.current.add(task.id)
      void runGenerateTask(task.id).finally(() => {
        inFlightTaskIdsRef.current.delete(task.id)
      })
    }
  }, [isProjectReady, nextQueuedTasks, runningTasks])

  return null
}
