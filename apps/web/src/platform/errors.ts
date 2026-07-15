export class ProjectVersionConflictError extends Error {
  readonly currentVersion: number | null
  readonly currentSequence: number | null

  constructor(options: {
    message?: string
    currentVersion?: number | null
    currentSequence?: number | null
    cause?: unknown
  } = {}) {
    super(options.message ?? '项目已在其他位置更新，请先处理云端版本冲突。', { cause: options.cause })
    this.name = 'ProjectVersionConflictError'
    this.currentVersion = options.currentVersion ?? null
    this.currentSequence = options.currentSequence ?? null
  }
}

export function isProjectVersionConflictError(error: unknown): error is ProjectVersionConflictError {
  return error instanceof ProjectVersionConflictError
}
