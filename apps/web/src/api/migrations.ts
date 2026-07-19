import type {
  CommitMigrationImportRequest,
  MigrationImportAssetUploadResponse,
  MigrationImportResponse,
  MigrationImportSummary,
  MigrationPackageArchiveEntry,
  MigrationPackageAsset,
  MigrationPackageCheckpoint,
  MigrationPackageManifest,
  MigrationProjectGraph,
  MigrationProjectRecord,
  MigrationExportDownloadResponse,
  MigrationExportResponse,
  PrepareMigrationExportRequest,
  PrepareMigrationImportRequest,
} from '@ai-canvas-cloud/contracts'
import { requestCloudJson } from './cloudApiClient.ts'

export interface ParsedMigrationPackage {
  manifest: MigrationPackageManifest
  projectRecord: MigrationProjectRecord
  graph: MigrationProjectGraph
  assetManifest: { schemaVersion: 1; assets: MigrationPackageAsset[] }
  checkpoint: MigrationPackageCheckpoint | null
  archiveEntries: MigrationPackageArchiveEntry[]
  files: Map<string, Uint8Array>
}

export type MigrationProgressHandler = (progress: number) => void

export async function prepareMigrationImport(input: PrepareMigrationImportRequest) {
  return requestCloudJson<MigrationImportResponse>('/migrations/imports/prepare', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function getMigrationImport(importId: string) {
  return requestCloudJson<MigrationImportResponse>(`/migrations/imports/${encodeURIComponent(importId)}`)
}

export async function cancelMigrationImport(importId: string) {
  return requestCloudJson<MigrationImportResponse>(`/migrations/imports/${encodeURIComponent(importId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function commitMigrationImport(importId: string, input: CommitMigrationImportRequest) {
  return requestCloudJson<{ importId: string; status: 'completed'; strategy: 'copy' | 'replace'; project: { id: string; name: string; version: number; sequence: number }; assetCount: number; checkpoint: { id: string; projectVersion: number; sequence: number } | null }>(
    `/migrations/imports/${encodeURIComponent(importId)}/commit`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export async function prepareMigrationAssetUpload(importId: string, logicalAssetId: string) {
  return requestCloudJson<MigrationImportAssetUploadResponse>(
    `/migrations/imports/${encodeURIComponent(importId)}/assets/${encodeURIComponent(logicalAssetId)}/upload`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export async function getMigrationAssetUpload(importId: string, logicalAssetId: string) {
  return requestCloudJson<MigrationImportAssetUploadResponse>(
    `/migrations/imports/${encodeURIComponent(importId)}/assets/${encodeURIComponent(logicalAssetId)}/upload`,
  )
}

export async function completeMigrationAssetUpload(importId: string, logicalAssetId: string, parts?: Record<string, { etag: string; byteSize: number }>) {
  return requestCloudJson<MigrationImportAssetUploadResponse>(
    `/migrations/imports/${encodeURIComponent(importId)}/assets/${encodeURIComponent(logicalAssetId)}/complete`,
    { method: 'POST', body: JSON.stringify(parts ? { parts } : {}) },
  )
}

export async function completeMigrationAssetPart(importId: string, logicalAssetId: string, partNumber: number, input: { etag: string; byteSize: number }) {
  return requestCloudJson<MigrationImportAssetUploadResponse>(
    `/migrations/imports/${encodeURIComponent(importId)}/assets/${encodeURIComponent(logicalAssetId)}/parts/${partNumber}/complete`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export async function uploadToSignedUrl(url: string, blob: Blob, headers: Record<string, string>, onProgress?: MigrationProgressHandler) {
  return new Promise<{ etag: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new Error('资产上传网络错误'))
    xhr.onabort = () => reject(new Error('资产上传已取消'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ etag: xhr.getResponseHeader('etag') })
      else reject(new Error(`资产上传失败（${xhr.status}）`))
    }
    xhr.send(blob)
  })
}

export async function prepareMigrationExport(projectId: string, input: PrepareMigrationExportRequest) {
  return requestCloudJson<MigrationExportResponse>(`/projects/${encodeURIComponent(projectId)}/exports/prepare`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function getMigrationExport(projectId: string, exportId: string) {
  return requestCloudJson<MigrationExportResponse>(`/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportId)}`)
}

export async function downloadMigrationExport(projectId: string, exportId: string) {
  return requestCloudJson<MigrationExportDownloadResponse>(`/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportId)}/download`)
}

export async function cancelMigrationExport(projectId: string, exportId: string) {
  return requestCloudJson<MigrationExportResponse>(`/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportId)}/cancel`, { method: 'POST', body: JSON.stringify({}) })
}

export async function retryMigrationExport(projectId: string, exportId: string) {
  return requestCloudJson<MigrationExportResponse>(`/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportId)}/retry`, { method: 'POST', body: JSON.stringify({}) })
}

function readU16(view: DataView, offset: number) { return view.getUint16(offset, true) }
function readU32(view: DataView, offset: number) { return view.getUint32(offset, true) }

export function toOwnedArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function inflateRaw(bytes: Uint8Array) {
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  await writer.write(toOwnedArrayBuffer(bytes))
  await writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

export async function parseMigrationPackage(blob: Blob): Promise<ParsedMigrationPackage> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (readU32(view, index) === 0x06054b50) { eocd = index; break }
  }
  if (eocd < 0) throw new Error('无法读取目录包：ZIP 目录损坏')
  const entryCount = readU16(view, eocd + 10)
  const centralOffset = readU32(view, eocd + 16)
  const decoder = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  const archiveEntries: MigrationPackageArchiveEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(view, cursor) !== 0x02014b50) throw new Error('无法读取目录包：条目目录损坏')
    const method = readU16(view, cursor + 10)
    const compressedSize = readU32(view, cursor + 20)
    const uncompressedSize = readU32(view, cursor + 24)
    const nameLength = readU16(view, cursor + 28)
    const extraLength = readU16(view, cursor + 30)
    const commentLength = readU16(view, cursor + 32)
    const localOffset = readU32(view, cursor + 42)
    const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength + extraLength + commentLength
    if (path.endsWith('/')) {
      archiveEntries.push({ path, kind: 'directory', uncompressedSize, compressedSize })
      continue
    }
    const localNameLength = readU16(view, localOffset + 26)
    const localExtraLength = readU16(view, localOffset + 28)
    const bodyStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(bodyStart, bodyStart + compressedSize)
    const body = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : (() => { throw new Error(`不支持 ZIP 压缩方式：${method}`) })()
    if (body.byteLength !== uncompressedSize) throw new Error(`目录包条目大小不一致：${path}`)
    files.set(path, body)
    archiveEntries.push({ path, kind: 'file', uncompressedSize, compressedSize })
  }
  const readJson = <T>(path: string) => {
    const body = files.get(path)
    if (!body) throw new Error(`目录包缺少 ${path}`)
    try { return JSON.parse(decoder.decode(body)) as T } catch { throw new Error(`${path} 不是有效 JSON`) }
  }
  return {
    manifest: readJson<MigrationPackageManifest>('manifest.json'),
    projectRecord: readJson<MigrationProjectRecord>('project.json'),
    graph: readJson<MigrationProjectGraph>('graph.json'),
    assetManifest: readJson<{ schemaVersion: 1; assets: MigrationPackageAsset[] }>('assets.json'),
    checkpoint: files.has('checkpoint.json') ? readJson<MigrationPackageCheckpoint>('checkpoint.json') : null,
    archiveEntries,
    files,
  }
}

export function migrationSummaryLabel(summary: MigrationImportSummary) {
  return `${summary.project.name} · ${summary.progress.completedFileCount}/${summary.estimates.fileCount} 个文件`
}
