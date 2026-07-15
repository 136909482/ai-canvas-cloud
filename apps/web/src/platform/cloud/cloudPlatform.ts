import type {
  ApplyProjectGraphOperationsRequest,
  ApplyProjectGraphOperationsResponse,
  CurrentWorkspaceResponse,
  ProjectGraphResponse,
  ProjectListStatus,
  ProjectResponse,
  ProjectSummary,
  ProjectsResponse,
} from '@ai-canvas-cloud/contracts'
import type { CanvasSnapshot, ProjectRecord, ProjectSnapshot, WorkflowTemplateLibrary, WorkspaceConfigFile, WorkspaceData } from '@/types'
import { CloudApiError, requestCloudJson } from '@/api/cloudApiClient'
import { CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION } from '@/features/projectManager/migrations'
import { extractProjectSearchDocuments, searchWorkspaceDocuments } from '@/features/workspaceSearch/runtime'
import {
  diffCanvasSnapshots,
  projectGraphResponseToCanvasSnapshot,
} from '@/platform/cloud/cloudProjectGraph'
import type {
  CleanupWorkspaceAssetsResult,
  CommitProjectBundleImportResult,
  ImportWorkspaceBundleResult,
  PlatformBridge,
  ProjectBundleImportCandidate,
  SaveWorkspaceProjectInput,
  WorkflowFile,
  WorkflowImportResult,
  WorkspaceAssetDiskInspection,
  WorkspaceAssetWriteResult,
  WorkspaceProjectSummary,
  WorkspaceStatus,
} from '@/platform/types'

const memoryAssetUrls = new Map<string, string>()
const memoryAssetBlobs = new Map<string, Blob>()
const knownProjectSummaries = new Map<string, ProjectSummary>()
const cloudProjectStates = new Map<string, CloudProjectState>()

interface PendingGraphSave {
  request: ApplyProjectGraphOperationsRequest
  targetCanvas: CanvasSnapshot
}

interface CloudProjectState {
  summary: ProjectSummary
  version: number
  sequence: number
  baselineCanvas: CanvasSnapshot
  pending?: PendingGraphSave
}

let memoryWorkspaceData: WorkspaceData = {
  projects: [],
  activeProjectId: null,
  lastOpenedProjectId: null,
}
let memoryConfig: WorkspaceConfigFile | null = null
let memoryTemplates: WorkflowTemplateLibrary | null = null
let currentWorkspaceId: string | null = null
let cloudClientId: string | null = null

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getWorkspaceStatus(directoryName: string): WorkspaceStatus {
  return {
    supported: true,
    configured: true,
    directoryName,
    permission: 'granted',
  }
}

async function loadWorkspaceStatus() {
  const response = await requestCloudJson<CurrentWorkspaceResponse>('/workspaces/current')
  setCurrentWorkspace(response.workspace.id)
  return getWorkspaceStatus(response.workspace.name)
}

function getCloudClientId() {
  cloudClientId ??= `browser_${crypto.randomUUID()}`
  return cloudClientId
}

function setCurrentWorkspace(workspaceId: string) {
  if (currentWorkspaceId === workspaceId) {
    return
  }

  resetCloudSessionCache()
  currentWorkspaceId = workspaceId
}

function resetCloudSessionCache() {
  for (const url of memoryAssetUrls.values()) {
    URL.revokeObjectURL(url)
  }
  memoryAssetUrls.clear()
  memoryAssetBlobs.clear()
  knownProjectSummaries.clear()
  cloudProjectStates.clear()
  currentWorkspaceId = null
  cloudClientId = null
  memoryConfig = null
  memoryTemplates = null
  memoryWorkspaceData = {
    projects: [],
    activeProjectId: null,
    lastOpenedProjectId: null,
  }
}

function toTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

function toWorkspaceProjectSummary(project: ProjectSummary): WorkspaceProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: toTimestamp(project.createdAt),
    updatedAt: toTimestamp(project.updatedAt),
    lastOpenedAt: toTimestamp(project.updatedAt),
    archivedAt: project.archivedAt ? toTimestamp(project.archivedAt) : null,
  }
}

function emptyProjectSnapshot(canvas: CanvasSnapshot = { nodes: [], edges: [] }): ProjectSnapshot {
  return {
    schemaVersion: CURRENT_PROJECT_SNAPSHOT_SCHEMA_VERSION,
    canvas: cloneJson(canvas),
    taskQueue: { tasks: [] },
  }
}

function toProjectRecord(summary: ProjectSummary, graph: ProjectGraphResponse): ProjectRecord {
  const canvas = projectGraphResponseToCanvasSnapshot(graph)
  const snapshot = emptyProjectSnapshot(canvas)
  const cachedTaskQueue = memoryWorkspaceData.projects.find((project) => project.id === summary.id)
    ?.workingSnapshot.taskQueue

  if (cachedTaskQueue) {
    snapshot.taskQueue = cloneJson(cachedTaskQueue)
  }

  return {
    id: summary.id,
    name: summary.name,
    savedSnapshot: snapshot,
    workingSnapshot: cloneJson(snapshot),
    createdAt: toTimestamp(summary.createdAt),
    updatedAt: toTimestamp(summary.updatedAt),
    lastOpenedAt: Date.now(),
    archivedAt: summary.archivedAt ? toTimestamp(summary.archivedAt) : null,
  }
}

function cacheProjectRecord(project: ProjectRecord) {
  const cloned = cloneJson(project)
  const existingIndex = memoryWorkspaceData.projects.findIndex((item) => item.id === project.id)
  memoryWorkspaceData.projects = existingIndex >= 0
    ? memoryWorkspaceData.projects.map((item, index) => index === existingIndex ? cloned : item)
    : [...memoryWorkspaceData.projects, cloned]
}

function updateWorkspaceSelection(input: Pick<SaveWorkspaceProjectInput, 'activeProjectId' | 'lastOpenedProjectId'>) {
  if ('activeProjectId' in input) {
    memoryWorkspaceData.activeProjectId = input.activeProjectId ?? null
  }
  if ('lastOpenedProjectId' in input) {
    memoryWorkspaceData.lastOpenedProjectId = input.lastOpenedProjectId ?? null
  }
}

async function listProjectsByStatus(status: ProjectListStatus) {
  const projects: ProjectSummary[] = []
  let cursor: string | null = null

  do {
    const query = new URLSearchParams({ status, limit: '100' })
    if (cursor) {
      query.set('cursor', cursor)
    }
    const response = await requestCloudJson<ProjectsResponse>(`/projects?${query.toString()}`)
    projects.push(...response.projects)
    cursor = response.nextCursor
  } while (cursor)

  return projects
}

async function loadCloudProject(projectId: string) {
  const [metadata, graph] = await Promise.all([
    requestCloudJson<ProjectResponse>(`/projects/${encodeURIComponent(projectId)}`),
    requestCloudJson<ProjectGraphResponse>(`/projects/${encodeURIComponent(projectId)}/graph`),
  ])
  const project = toProjectRecord(metadata.project, graph)

  knownProjectSummaries.set(projectId, metadata.project)
  cloudProjectStates.set(projectId, {
    summary: metadata.project,
    version: graph.version,
    sequence: graph.sequence,
    baselineCanvas: cloneJson(project.workingSnapshot.canvas),
  })
  cacheProjectRecord(project)
  return project
}

async function ensureCloudProject(project: ProjectRecord) {
  const cached = cloudProjectStates.get(project.id)
  if (cached) {
    return cached
  }

  if (knownProjectSummaries.has(project.id)) {
    await loadCloudProject(project.id)
    return cloudProjectStates.get(project.id)!
  }

  const created = await requestCloudJson<ProjectResponse>('/projects', {
    method: 'POST',
    body: JSON.stringify({ id: project.id, name: project.name }),
  })
  const state: CloudProjectState = {
    summary: created.project,
    version: created.project.version,
    sequence: created.project.lastSequence,
    baselineCanvas: { nodes: [], edges: [] },
  }

  knownProjectSummaries.set(project.id, created.project)
  cloudProjectStates.set(project.id, state)
  return state
}

async function updateProjectMetadata(state: CloudProjectState, response: Promise<ProjectResponse>) {
  const result = await response
  state.summary = result.project
  knownProjectSummaries.set(result.project.id, result.project)
}

async function flushPendingGraphSave(projectId: string, state: CloudProjectState) {
  const pending = state.pending
  if (!pending) {
    return
  }

  try {
    const result = await requestCloudJson<ApplyProjectGraphOperationsResponse>(
      `/projects/${encodeURIComponent(projectId)}/graph`,
      { method: 'PATCH', body: JSON.stringify(pending.request) },
    )
    state.version = result.version
    state.sequence = result.sequence
    state.baselineCanvas = cloneJson(pending.targetCanvas)
    state.pending = undefined
    state.summary = {
      ...state.summary,
      version: result.version,
      lastSequence: result.sequence,
      nodeCount: pending.targetCanvas.nodes.length,
      edgeCount: pending.targetCanvas.edges.length,
      updatedAt: result.updatedAt,
    }
    knownProjectSummaries.set(projectId, state.summary)
  } catch (error) {
    if (error instanceof CloudApiError && error.code === 'PROJECT_VERSION_CONFLICT') {
      throw new Error('项目已在其他位置更新，请重新加载云端版本后再处理本地修改。', { cause: error })
    }
    throw error
  }
}

async function saveCloudProject(input: SaveWorkspaceProjectInput) {
  const project = cloneJson(input.project)
  const state = await ensureCloudProject(project)

  updateWorkspaceSelection(input)

  if (state.summary.archivedAt && !project.archivedAt) {
    await updateProjectMetadata(
      state,
      requestCloudJson<ProjectResponse>(`/projects/${encodeURIComponent(project.id)}/restore`, { method: 'POST' }),
    )
  }
  if (state.summary.name !== project.name) {
    await updateProjectMetadata(
      state,
      requestCloudJson<ProjectResponse>(`/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: project.name }),
      }),
    )
  }

  await flushPendingGraphSave(project.id, state)
  const targetCanvas = cloneJson(project.workingSnapshot.canvas)
  const operations = diffCanvasSnapshots(state.baselineCanvas, targetCanvas)

  if (operations.length > 500) {
    throw new Error('本次画布变化超过 500 个操作，请缩小单次修改规模后重试。')
  }
  if (operations.length > 0) {
    const requestId = crypto.randomUUID()
    state.pending = {
      request: {
        baseVersion: state.version,
        clientId: getCloudClientId(),
        batchId: `batch_${requestId}`,
        idempotencyKey: `graph_${requestId}`,
        operations,
      },
      targetCanvas,
    }
    await flushPendingGraphSave(project.id, state)
  }

  if (!state.summary.archivedAt && project.archivedAt) {
    await updateProjectMetadata(
      state,
      requestCloudJson<ProjectResponse>(`/projects/${encodeURIComponent(project.id)}/archive`, { method: 'POST' }),
    )
  }

  cacheProjectRecord(project)
}

function normalizeAssetPath(relativePath: string) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function createAssetResult(relativePath: string, fileName: string, blob: Blob): WorkspaceAssetWriteResult {
  const normalizedPath = normalizeAssetPath(relativePath)
  const previousUrl = memoryAssetUrls.get(normalizedPath)

  if (previousUrl) {
    URL.revokeObjectURL(previousUrl)
  }

  memoryAssetBlobs.set(normalizedPath, blob)
  memoryAssetUrls.set(normalizedPath, URL.createObjectURL(blob))

  return {
    relativePath: normalizedPath,
    fileName,
    mimeType: blob.type || 'application/octet-stream',
  }
}

function triggerDownload(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildWorkflowFile(snapshot: CanvasSnapshot, suggestedName: string): WorkflowFile {
  return {
    type: 'ai-canvas-workflow',
    version: 1,
    meta: {
      name: suggestedName.replace(/\.json$/i, '').trim() || 'workflow',
      exportedAt: Date.now(),
    },
    nodes: snapshot.nodes,
    edges: snapshot.edges,
  }
}

function isWorkflowFile(value: Partial<CanvasSnapshot> | Partial<WorkflowFile> | null): value is WorkflowFile {
  return Boolean(
    value
    && typeof value === 'object'
    && 'type' in value
    && 'version' in value
    && value.type === 'ai-canvas-workflow'
    && value.version === 1
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges),
  )
}

function parseCanvasSnapshot(content: string): CanvasSnapshot {
  const parsed = JSON.parse(content) as Partial<CanvasSnapshot> | Partial<WorkflowFile> | null

  if (isWorkflowFile(parsed)) {
    return {
      nodes: parsed.nodes,
      edges: parsed.edges,
    }
  }

  if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('工作流文件格式不正确')
  }

  return {
    nodes: parsed.nodes,
    edges: parsed.edges,
  }
}

function chooseWorkflowFile() {
  return new Promise<File>((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('未选择工作流文件'))
        return
      }

      resolve(file)
    }

    input.click()
  })
}

function unsupportedCloudImportExport(): never {
  throw new Error('Cloud 导入导出将在后续迁移阶段接入')
}

export const cloudPlatformBridge: PlatformBridge = {
  resetSessionCache() {
    resetCloudSessionCache()
  },

  async getWorkspaceStatus() {
    return loadWorkspaceStatus()
  },

  async pickWorkspaceDirectory() {
    return loadWorkspaceStatus()
  },

  async loadWorkspaceData() {
    return cloneJson(memoryWorkspaceData)
  },

  async saveWorkspaceData(data) {
    memoryWorkspaceData.activeProjectId = data.activeProjectId
    memoryWorkspaceData.lastOpenedProjectId = data.lastOpenedProjectId
  },

  async listWorkspaceProjects() {
    const projects = [
      ...await listProjectsByStatus('active'),
      ...await listProjectsByStatus('archived'),
    ]
    knownProjectSummaries.clear()
    for (const project of projects) {
      knownProjectSummaries.set(project.id, project)
    }
    const projectIds = new Set(projects.map((project) => project.id))
    memoryWorkspaceData.projects = memoryWorkspaceData.projects.filter((project) => projectIds.has(project.id))

    return {
      projects: projects.map(toWorkspaceProjectSummary),
      activeProjectId: memoryWorkspaceData.activeProjectId && projectIds.has(memoryWorkspaceData.activeProjectId)
        ? memoryWorkspaceData.activeProjectId
        : null,
      lastOpenedProjectId: memoryWorkspaceData.lastOpenedProjectId && projectIds.has(memoryWorkspaceData.lastOpenedProjectId)
        ? memoryWorkspaceData.lastOpenedProjectId
        : null,
    }
  },

  async loadWorkspaceProject(projectId) {
    return loadCloudProject(projectId)
  },

  async saveWorkspaceProject(input) {
    await saveCloudProject(input)
  },

  async deleteWorkspaceProject(input) {
    await requestCloudJson(`/projects/${encodeURIComponent(input.projectId)}`, { method: 'DELETE' })
    knownProjectSummaries.delete(input.projectId)
    cloudProjectStates.delete(input.projectId)
    memoryWorkspaceData = {
      projects: memoryWorkspaceData.projects.filter((project) => project.id !== input.projectId),
      activeProjectId: 'activeProjectId' in input ? input.activeProjectId ?? null : memoryWorkspaceData.activeProjectId,
      lastOpenedProjectId: 'lastOpenedProjectId' in input ? input.lastOpenedProjectId ?? null : memoryWorkspaceData.lastOpenedProjectId,
    }
  },

  async loadWorkspaceConfig() {
    return memoryConfig ? cloneJson(memoryConfig) : null
  },

  async saveWorkspaceConfig(config) {
    memoryConfig = cloneJson(config)
  },

  async loadWorkflowTemplates() {
    return memoryTemplates ? cloneJson(memoryTemplates) : null
  },

  async saveWorkflowTemplates(library) {
    memoryTemplates = cloneJson(library)
  },

  async writeWorkspaceAsset(input) {
    const extension = input.fileName.split('.').pop() || 'bin'
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`
    return createAssetResult(
      ['cloud-memory', ...input.pathSegments, fileName].join('/'),
      fileName,
      input.blob,
    )
  },

  async writeWorkspaceAssetAtPath(input) {
    const relativePath = normalizeAssetPath(input.relativePath)
    const fileName = relativePath.split('/').pop() || 'asset'
    return createAssetResult(relativePath, fileName, input.blob)
  },

  async resolveWorkspaceAssetUrl(relativePath) {
    const normalizedPath = normalizeAssetPath(relativePath)
    const url = memoryAssetUrls.get(normalizedPath)

    if (!url) {
      throw new Error('内存资源不存在，请重新导入或生成该资源')
    }

    return url
  },

  clearWorkspaceAssetUrlCache() {
    for (const url of memoryAssetUrls.values()) {
      URL.revokeObjectURL(url)
    }

    memoryAssetUrls.clear()
    memoryAssetBlobs.clear()
  },

  async inspectWorkspaceAssets(): Promise<WorkspaceAssetDiskInspection> {
    const entries = [...memoryAssetBlobs.entries()].map(([relativePath, blob]) => ({
      relativePath,
      byteSize: blob.size,
    }))
    const totalByteSize = entries.reduce((total, entry) => total + entry.byteSize, 0)

    return {
      scannedAt: Date.now(),
      totalFileCount: entries.length,
      totalByteSize,
      referencedFileCount: entries.length,
      referencedByteSize: totalByteSize,
      orphanedFileCount: 0,
      orphanedByteSize: 0,
      orphanedFiles: [],
      missingReferencedPaths: [],
    }
  },

  async cleanupUnusedWorkspaceAssets(): Promise<CleanupWorkspaceAssetsResult> {
    return {
      deletedCount: 0,
      deletedByteSize: 0,
    }
  },

  async queryWorkspaceAudit() {
    return { supported: false, entries: [], totalCount: 0, hasMore: false }
  },

  async searchWorkspace(query) {
    const documents = memoryWorkspaceData.projects.flatMap(extractProjectSearchDocuments)
    return {
      supported: false,
      indexedDocumentCount: documents.length,
      entries: searchWorkspaceDocuments(documents, query),
    }
  },

  async exportWorkflowJson(snapshot, suggestedName) {
    triggerDownload(JSON.stringify(buildWorkflowFile(snapshot, suggestedName), null, 2), suggestedName)
  },

  async importWorkflowJson(): Promise<WorkflowImportResult> {
    const file = await chooseWorkflowFile()
    return {
      snapshot: parseCanvasSnapshot(await file.text()),
      fileName: file.name,
    }
  },

  async exportWorkspaceBundle() {
    unsupportedCloudImportExport()
  },

  async importWorkspaceBundle(): Promise<ImportWorkspaceBundleResult> {
    unsupportedCloudImportExport()
  },

  async exportProjectBundle() {
    unsupportedCloudImportExport()
  },

  async prepareProjectBundleImport(): Promise<ProjectBundleImportCandidate> {
    unsupportedCloudImportExport()
  },

  async commitProjectBundleImport(): Promise<CommitProjectBundleImportResult> {
    unsupportedCloudImportExport()
  },
}
