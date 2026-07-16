import type { GenerationTaskStatus } from '@ai-canvas-cloud/contracts'

const TASK_STATUS_TRANSITIONS: Readonly<Record<GenerationTaskStatus, ReadonlySet<GenerationTaskStatus>>> = {
  queued: new Set(['running', 'canceled']),
  running: new Set(['queued', 'succeeded', 'failed', 'canceled']),
  succeeded: new Set(),
  failed: new Set(['queued']),
  canceled: new Set(),
}

export function canTransitionGenerationTask(
  from: GenerationTaskStatus,
  to: GenerationTaskStatus,
) {
  return from === to || TASK_STATUS_TRANSITIONS[from].has(to)
}

export function assertGenerationTaskTransition(
  from: GenerationTaskStatus,
  to: GenerationTaskStatus,
) {
  if (!canTransitionGenerationTask(from, to)) {
    throw new Error(`Generation task cannot transition from ${from} to ${to}`)
  }
}

export function normalizeGenerationTaskProgress(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('Generation task progress must be finite')
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function isGenerationTaskTerminal(status: GenerationTaskStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}
