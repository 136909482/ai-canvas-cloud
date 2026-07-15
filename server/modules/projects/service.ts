import type {
  CreateProjectRequest,
  DeleteProjectResponse,
  ProjectListStatus,
  ProjectResponse,
  ProjectsResponse,
  RenameProjectRequest,
} from '@ai-canvas-cloud/contracts'
import { AuthServiceError } from '../auth/service.js'

export const PROJECT_NAME_MAX_LENGTH = 160
export const PROJECT_LIST_DEFAULT_LIMIT = 50
export const PROJECT_LIST_MAX_LIMIT = 100
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ProjectActor {
  userId: string
  workspaceId: string
}

export interface ListProjectsInput {
  status?: ProjectListStatus
  cursor?: string | null
  limit?: number
}

export interface ProjectService {
  listProjects: (input: ListProjectsInput, actor: ProjectActor) => Promise<ProjectsResponse>
  createProject: (input: CreateProjectRequest, actor: ProjectActor) => Promise<ProjectResponse>
  getProject: (projectId: string, actor: ProjectActor) => Promise<ProjectResponse>
  renameProject: (projectId: string, input: RenameProjectRequest, actor: ProjectActor) => Promise<ProjectResponse>
  archiveProject: (projectId: string, actor: ProjectActor) => Promise<ProjectResponse>
  restoreProject: (projectId: string, actor: ProjectActor) => Promise<ProjectResponse>
  deleteProject: (projectId: string, actor: ProjectActor) => Promise<DeleteProjectResponse>
}

export function normalizeProjectName(name: unknown) {
  if (typeof name !== 'string') {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Project name must be a string',
    })
  }

  const normalized = name.trim()

  if (!normalized) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Project name is required',
    })
  }

  if (normalized.length > PROJECT_NAME_MAX_LENGTH) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: `Project name must be at most ${PROJECT_NAME_MAX_LENGTH} characters`,
    })
  }

  return normalized
}

export function normalizeProjectId(projectId: unknown) {
  if (projectId === undefined) {
    return undefined
  }

  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Invalid project id',
    })
  }

  return projectId.toLowerCase()
}

export function createUnavailableProjectService(): ProjectService {
  const unavailable = () => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: 'SERVICE_UNAVAILABLE',
      message: 'Project service is not configured',
      retryable: true,
    })
  }

  return {
    async listProjects() {
      return unavailable()
    },
    async createProject() {
      return unavailable()
    },
    async getProject() {
      return unavailable()
    },
    async renameProject() {
      return unavailable()
    },
    async archiveProject() {
      return unavailable()
    },
    async restoreProject() {
      return unavailable()
    },
    async deleteProject() {
      return unavailable()
    },
  }
}
