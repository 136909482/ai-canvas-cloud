import { createHash } from 'node:crypto'
import type { CloudProviderId } from '@ai-canvas-cloud/contracts'
import type { MetricsRegistry } from '@ai-canvas-cloud/shared'
import { isAllowedProviderResultUrl } from '../providers/registry.js'
import type { TaskResultAsset } from './execution.js'

export const TASK_RESULT_TRANSFER_MAX_BYTES = 50 * 1024 * 1024

const RESULT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

export interface TaskResultObjectStorage {
  putObject: (input: {
    objectKey: string
    mimeType: string
    body: Uint8Array
  }) => Promise<void>
}

export interface TaskInputObjectStorage {
  getObjectBytes: (input: { objectKey: string; maxBytes: number }) => Promise<Uint8Array>
}

export class TaskResultTransferError extends Error {
  constructor(
    readonly code: 'RESULT_URL_REJECTED' | 'RESULT_RATE_LIMITED' | 'RESULT_DOWNLOAD_FAILED' | 'RESULT_TOO_LARGE' | 'RESULT_VALIDATION_FAILED' | 'RESULT_TRANSFER_FAILED',
  ) {
    super(code)
    this.name = 'TaskResultTransferError'
  }
}

type ResultFetch = (url: string, init: RequestInit) => Promise<Response>

function normalizeMimeType(value: string | null) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'video/webm': return 'webm'
    case 'video/quicktime': return 'mov'
    default: return 'mp4'
  }
}

function deterministicUuid(value: string) {
  const bytes = createHash('sha1').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function assertMagicMatches(mimeType: string, bytes: Uint8Array) {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value)
  const isPng = startsWith(0x89, 0x50, 0x4e, 0x47)
  const isJpeg = startsWith(0xff, 0xd8, 0xff)
  const isWebp = startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  const isIsoVideo = String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  const matches = (mimeType === 'image/png' && isPng)
    || (mimeType === 'image/jpeg' && isJpeg)
    || (mimeType === 'image/webp' && isWebp)
    || ((mimeType === 'video/mp4' || mimeType === 'video/quicktime') && isIsoVideo)
    || (mimeType === 'video/webm' && startsWith(0x1a, 0x45, 0xdf, 0xa3))
  if (!matches) {
    throw new TaskResultTransferError('RESULT_VALIDATION_FAILED')
  }
}

async function readLimitedBody(response: Response, maxBytes: number) {
  const contentLength = response.headers.get('content-length')
  if (contentLength && (!Number.isSafeInteger(Number(contentLength)) || Number(contentLength) > maxBytes)) {
    throw new TaskResultTransferError('RESULT_TOO_LARGE')
  }
  if (!response.body) {
    throw new TaskResultTransferError('RESULT_DOWNLOAD_FAILED')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      total += chunk.value.byteLength
      if (total > maxBytes) {
        throw new TaskResultTransferError('RESULT_TOO_LARGE')
      }
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  if (total === 0) {
    throw new TaskResultTransferError('RESULT_VALIDATION_FAILED')
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function transferProviderTaskResultInternal(input: {
  providerId: CloudProviderId
  resultUrl: string
  workspaceId: string
  projectId: string
  taskId: string
  resultIndex: number
  objectStorage: TaskResultObjectStorage
  fetch?: ResultFetch
  maxBytes?: number
  metrics?: MetricsRegistry
}): Promise<TaskResultAsset> {
  if (!isAllowedProviderResultUrl(input.providerId, input.resultUrl)) {
    throw new TaskResultTransferError('RESULT_URL_REJECTED')
  }
  if (!Number.isInteger(input.resultIndex) || input.resultIndex < 0 || input.resultIndex > 15) {
    throw new Error('resultIndex must be between 0 and 15')
  }
  const maxBytes = input.maxBytes ?? TASK_RESULT_TRANSFER_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer')
  }
  const providerFetch = input.fetch ?? ((url, init) => fetch(url, init))
  let response: Response
  try {
    response = await providerFetch(input.resultUrl, { method: 'GET', redirect: 'error' })
  } catch {
    throw new TaskResultTransferError('RESULT_DOWNLOAD_FAILED')
  }
  if (response.status === 429) {
    throw new TaskResultTransferError('RESULT_RATE_LIMITED')
  }
  if (!response.ok) {
    throw new TaskResultTransferError('RESULT_DOWNLOAD_FAILED')
  }
  const mimeType = normalizeMimeType(response.headers.get('content-type'))
  if (!RESULT_MIME_TYPES.has(mimeType)) {
    throw new TaskResultTransferError('RESULT_VALIDATION_FAILED')
  }
  const body = await readLimitedBody(response, maxBytes)
  return storeProviderTaskResultBytesInternal({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    resultIndex: input.resultIndex,
    objectStorage: input.objectStorage,
    mimeType,
    body,
  })
}

export async function transferProviderTaskResult(input: Parameters<typeof transferProviderTaskResultInternal>[0]): Promise<TaskResultAsset> {
  try {
    return await transferProviderTaskResultInternal(input)
  } catch (error) {
    input.metrics?.increment('task_result_transfer_failures_total', 1, {
      code: error instanceof TaskResultTransferError ? error.code : 'unknown',
    })
    throw error
  }
}

async function storeProviderTaskResultBytesInternal(input: {
  workspaceId: string
  projectId: string
  taskId: string
  resultIndex: number
  objectStorage: TaskResultObjectStorage
  mimeType: string
  body: Uint8Array
  metrics?: MetricsRegistry
}): Promise<TaskResultAsset> {
  const mimeType = normalizeMimeType(input.mimeType)
  if (!RESULT_MIME_TYPES.has(mimeType) || input.body.byteLength < 1 || input.body.byteLength > TASK_RESULT_TRANSFER_MAX_BYTES) {
    throw new TaskResultTransferError('RESULT_VALIDATION_FAILED')
  }
  if (!Number.isInteger(input.resultIndex) || input.resultIndex < 0 || input.resultIndex > 15) {
    throw new Error('resultIndex must be between 0 and 15')
  }
  assertMagicMatches(mimeType, input.body)
  const assetId = deterministicUuid(`task-result:${input.taskId}:${input.resultIndex}`)
  const objectKey = `workspaces/${input.workspaceId}/projects/${input.projectId}/generated/task-results/${input.taskId}/${input.resultIndex}.${extensionForMimeType(mimeType)}`
  try {
    await input.objectStorage.putObject({ objectKey, mimeType, body: input.body })
  } catch {
    throw new TaskResultTransferError('RESULT_TRANSFER_FAILED')
  }
  return {
    assetId,
    objectKey,
    originalFileName: `result-${input.resultIndex}.${extensionForMimeType(mimeType)}`,
    mimeType,
    byteSize: input.body.byteLength,
    sha256: createHash('sha256').update(input.body).digest('hex'),
  }
}

export async function storeProviderTaskResultBytes(input: Parameters<typeof storeProviderTaskResultBytesInternal>[0]): Promise<TaskResultAsset> {
  try {
    return await storeProviderTaskResultBytesInternal(input)
  } catch (error) {
    input.metrics?.increment('task_result_transfer_failures_total', 1, {
      code: error instanceof TaskResultTransferError ? error.code : 'unknown',
    })
    throw error
  }
}
