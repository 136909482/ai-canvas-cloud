import type { CanvasSnapshot, ProjectRecord, WorkflowTemplateLibrary, WorkspaceConfigFile, WorkspaceData } from '@/types'
import { extractProjectSearchDocuments, searchWorkspaceDocuments } from '@/features/workspaceSearch/runtime'
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
  WorkspaceProjectIndex,
  WorkspaceProjectSummary,
  WorkspaceStatus,
} from '@/platform/types'

const memoryAssetUrls = new Map<string, string>()
const memoryAssetBlobs = new Map<string, Blob>()

let memoryWorkspaceData: WorkspaceData = {
  projects: [],
  activeProjectId: null,
  lastOpenedProjectId: null,
}
let memoryConfig: WorkspaceConfigFile | null = null
let memoryTemplates: WorkflowTemplateLibrary | null = null

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getWorkspaceStatus(): WorkspaceStatus {
  return {
    supported: true,
    configured: true,
    directoryName: 'AI Canvas Cloud Memory',
    permission: 'granted',
  }
}

function getProjectSummary(project: ProjectRecord): WorkspaceProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
    archivedAt: project.archivedAt ?? null,
  }
}

function getProjectIndex(): WorkspaceProjectIndex {
  return {
    projects: memoryWorkspaceData.projects.map(getProjectSummary),
    activeProjectId: memoryWorkspaceData.activeProjectId,
    lastOpenedProjectId: memoryWorkspaceData.lastOpenedProjectId,
  }
}

function upsertProject(input: SaveWorkspaceProjectInput) {
  const project = cloneJson(input.project)
  const existingIndex = memoryWorkspaceData.projects.findIndex((item) => item.id === project.id)
  const projects = existingIndex >= 0
    ? memoryWorkspaceData.projects.map((item, index) => (index === existingIndex ? project : item))
    : [...memoryWorkspaceData.projects, project]

  memoryWorkspaceData = {
    projects,
    activeProjectId: 'activeProjectId' in input ? input.activeProjectId ?? null : memoryWorkspaceData.activeProjectId,
    lastOpenedProjectId: 'lastOpenedProjectId' in input ? input.lastOpenedProjectId ?? null : memoryWorkspaceData.lastOpenedProjectId,
  }
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
  throw new Error('Cloud 导入导出将在后续迁移阶段接入，当前仅启用内存画布适配器')
}

export const cloudPlatformBridge: PlatformBridge = {
  async getWorkspaceStatus() {
    return getWorkspaceStatus()
  },

  async pickWorkspaceDirectory() {
    return getWorkspaceStatus()
  },

  async loadWorkspaceData() {
    return cloneJson(memoryWorkspaceData)
  },

  async saveWorkspaceData(data) {
    memoryWorkspaceData = cloneJson(data)
  },

  async listWorkspaceProjects() {
    return getProjectIndex()
  },

  async loadWorkspaceProject(projectId) {
    const project = memoryWorkspaceData.projects.find((item) => item.id === projectId)
    return project ? cloneJson(project) : null
  },

  async saveWorkspaceProject(input) {
    upsertProject(input)
  },

  async deleteWorkspaceProject(input) {
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
      supported: true,
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
