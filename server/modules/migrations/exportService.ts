import type {
  MigrationExportDownloadResponse,
  MigrationExportResponse,
} from '@ai-canvas-cloud/contracts'
import type { WorkspaceRole } from '@ai-canvas-cloud/contracts'
import type { ProjectActor } from '../projects/service.js'
import { AuthServiceError } from '../auth/service.js'

export const MIGRATION_EXPORT_TTL_HOURS = 24
export const MIGRATION_EXPORT_DOWNLOAD_TTL_SECONDS = 5 * 60
export const MIGRATION_EXPORT_MAX_RETRIES = 3
export const MIGRATION_EXPORT_GC_GRACE_HOURS = 24
export const MIGRATION_EXPORT_WRITE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'editor']

export interface MigrationExportObjectStorage {
  getObjectBytes: (input: { objectKey: string; maxBytes: number }) => Promise<Uint8Array>
  putObject: (input: { objectKey: string; mimeType: string; body: Uint8Array }) => Promise<void>
  createPresignedDownload: (input: { objectKey: string; expiresInSeconds: number }) => Promise<{
    url: string
    expiresAt: string
  }>
  deleteObject: (objectKey: string) => Promise<void>
}

export interface MigrationExportService {
  prepareExport: (projectId: string, input: unknown, actor: ProjectActor) => Promise<MigrationExportResponse>
  getExport: (projectId: string, exportId: string, actor: ProjectActor) => Promise<MigrationExportResponse>
  cancelExport: (projectId: string, exportId: string, actor: ProjectActor) => Promise<MigrationExportResponse>
  retryExport: (projectId: string, exportId: string, actor: ProjectActor) => Promise<MigrationExportResponse>
  downloadExport: (projectId: string, exportId: string, actor: ProjectActor) => Promise<MigrationExportDownloadResponse>
  processExport: (exportId: string) => Promise<void>
  recoverExports: () => Promise<void>
  maintainExports: (options?: { graceHours?: number; batchSize?: number }) => Promise<number>
}

export function createUnavailableMigrationExportService(): MigrationExportService {
  const unavailable = () => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: 'SERVICE_UNAVAILABLE',
      message: 'Migration export service is not configured',
      retryable: true,
    })
  }
  return {
    async prepareExport() { return unavailable() },
    async getExport() { return unavailable() },
    async cancelExport() { return unavailable() },
    async retryExport() { return unavailable() },
    async downloadExport() { return unavailable() },
    async processExport() { return unavailable() },
    async recoverExports() { return unavailable() },
    async maintainExports() { return unavailable() },
  }
}

export interface ExportAssetFile {
  logicalAssetId: string
  filePath: string
  objectKey: string
  byteSize: number
  sha256: string
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUInt16(buffer: Buffer, offset: number, value: number) {
  buffer.writeUInt16LE(value, offset)
}

function writeUInt32(buffer: Buffer, offset: number, value: number) {
  buffer.writeUInt32LE(value >>> 0, offset)
}

interface ZipFile {
  path: string
  body: Uint8Array
}

function buildZip(files: ZipFile[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8')
    const body = Buffer.from(file.body)
    if (name.length > 0xffff || body.byteLength > 0xffffffff || offset > 0xffffffff) {
      throw new AuthServiceError({
        statusCode: 422,
        apiCode: 'PACKAGE_LIMIT_EXCEEDED',
        message: 'Migration export archive exceeds ZIP32 limits',
      })
    }
    const local = Buffer.alloc(30 + name.length)
    writeUInt32(local, 0, 0x04034b50)
    writeUInt16(local, 4, 20)
    writeUInt16(local, 6, 0x0800)
    writeUInt16(local, 8, 0)
    writeUInt16(local, 10, 0)
    writeUInt16(local, 12, 0)
    writeUInt32(local, 14, crc32(body))
    writeUInt32(local, 18, body.byteLength)
    writeUInt32(local, 22, body.byteLength)
    writeUInt16(local, 26, name.length)
    writeUInt16(local, 28, 0)
    name.copy(local, 30)
    localParts.push(local, body)

    const central = Buffer.alloc(46 + name.length)
    writeUInt32(central, 0, 0x02014b50)
    writeUInt16(central, 4, 20)
    writeUInt16(central, 6, 20)
    writeUInt16(central, 8, 0x0800)
    writeUInt16(central, 10, 0)
    writeUInt16(central, 12, 0)
    writeUInt32(central, 14, crc32(body))
    writeUInt32(central, 18, body.byteLength)
    writeUInt32(central, 22, body.byteLength)
    writeUInt16(central, 26, name.length)
    writeUInt16(central, 28, 0)
    writeUInt16(central, 30, 0)
    writeUInt16(central, 32, 0)
    writeUInt16(central, 34, 0)
    writeUInt32(central, 38, 0)
    writeUInt32(central, 42, offset)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.byteLength + body.byteLength
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  writeUInt32(end, 0, 0x06054b50)
  writeUInt16(end, 8, files.length)
  writeUInt16(end, 10, files.length)
  writeUInt32(end, 12, centralDirectory.byteLength)
  writeUInt32(end, 16, offset)
  return Buffer.concat([...localParts, centralDirectory, end])
}

export { buildZip }
