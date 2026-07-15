import type {
  CreateProjectCheckpointRequest,
  ProjectCheckpointType,
  ProjectCheckpointResponse,
  ProjectRevisionResponse,
  ProjectRevisionRestoreResponse,
  ProjectRevisionsResponse,
  RestoreProjectRevisionRequest,
} from '@ai-canvas-cloud/contracts'
import { AuthServiceError } from '../auth/service.js'
import type { ProjectActor } from '../projects/service.js'

export const PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION = 1
export const PROJECT_REVISIONS_DEFAULT_LIMIT = 20
export const PROJECT_REVISIONS_MAX_LIMIT = 100

export interface ProjectSnapshotService {
  listRevisions: (
    projectId: string,
    input: ListProjectRevisionsInput,
    actor: ProjectActor,
  ) => Promise<ProjectRevisionsResponse>
  getRevision: (
    projectId: string,
    version: number,
    actor: ProjectActor,
  ) => Promise<ProjectRevisionResponse>
  createCheckpoint: (
    projectId: string,
    input: CreateProjectCheckpointRequest,
    actor: ProjectActor,
  ) => Promise<ProjectCheckpointResponse>
  restoreRevision: (
    projectId: string,
    version: number,
    input: RestoreProjectRevisionRequest,
    actor: ProjectActor,
  ) => Promise<ProjectRevisionRestoreResponse>
}

export interface ListProjectRevisionsInput {
  cursor?: string | null
  limit?: number
}

export interface ValidatedCreateProjectCheckpointRequest {
  expectedVersion: number
  expectedSequence: number
  checkpointType: Extract<ProjectCheckpointType, 'manual' | 'periodic'>
}

function validationError(message: string): never {
  throw new AuthServiceError({
    statusCode: 400,
    apiCode: 'VALIDATION_FAILED',
    message,
  })
}

function requireNonNegativeSafeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return validationError(`${field} must be a non-negative safe integer`)
  }

  return Number(value)
}

export function validateCreateProjectCheckpointRequest(
  input: CreateProjectCheckpointRequest,
): ValidatedCreateProjectCheckpointRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationError('Checkpoint request must be an object')
  }

  if (
    input.checkpointType !== undefined
    && input.checkpointType !== 'manual'
    && input.checkpointType !== 'periodic'
  ) {
    return validationError('checkpointType must be manual or periodic')
  }

  return {
    expectedVersion: requireNonNegativeSafeInteger(input.expectedVersion, 'expectedVersion'),
    expectedSequence: requireNonNegativeSafeInteger(input.expectedSequence, 'expectedSequence'),
    checkpointType: input.checkpointType ?? 'manual',
  }
}

export function validateRestoreProjectRevisionRequest(
  input: RestoreProjectRevisionRequest,
): RestoreProjectRevisionRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationError('Restore request must be an object')
  }

  return {
    expectedVersion: requireNonNegativeSafeInteger(input.expectedVersion, 'expectedVersion'),
    expectedSequence: requireNonNegativeSafeInteger(input.expectedSequence, 'expectedSequence'),
  }
}

export function validateListProjectRevisionsInput(input: ListProjectRevisionsInput): Required<ListProjectRevisionsInput> {
  const limit = input.limit ?? PROJECT_REVISIONS_DEFAULT_LIMIT

  if (!Number.isInteger(limit) || limit < 1 || limit > PROJECT_REVISIONS_MAX_LIMIT) {
    return validationError(`Project revisions limit must be between 1 and ${PROJECT_REVISIONS_MAX_LIMIT}`)
  }

  if (input.cursor !== undefined && input.cursor !== null && typeof input.cursor !== 'string') {
    return validationError('Project revisions cursor must be a string')
  }

  return {
    cursor: input.cursor ?? null,
    limit,
  }
}

export function validateProjectRevisionVersion(value: unknown) {
  const version = typeof value === 'string' ? Number(value) : value

  if (!Number.isSafeInteger(version) || Number(version) < 0) {
    return validationError('Project revision version must be a non-negative safe integer')
  }

  return Number(version)
}

export function createUnavailableProjectSnapshotService(): ProjectSnapshotService {
  const unavailable = () => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: 'SERVICE_UNAVAILABLE',
      message: 'Project snapshot service is not configured',
      retryable: true,
    })
  }

  return {
    async listRevisions() {
      return unavailable()
    },
    async getRevision() {
      return unavailable()
    },
    async createCheckpoint() {
      return unavailable()
    },
    async restoreRevision() {
      return unavailable()
    },
  }
}
