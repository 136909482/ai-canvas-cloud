import type { ProviderId } from '@/config/modelCatalog'
import type { GptImageQuality, ImageInputFidelity, ImageOperationType, ImageRequestMode } from '@/types'

export interface GenerateImageParams {
  prompt: string
  negativePrompt?: string
  ratio?: string
  resolution?: string
  referenceImageUrl?: string | null
  referenceImageUrls?: string[]
  editImageUrl?: string | null
  maskImageUrl?: string | null
  apiKey: string
  apiUrl: string
  model: string
  provider?: ProviderId
  requestMode?: ImageRequestMode
  operationType?: ImageOperationType
  inputFidelity?: ImageInputFidelity | null
  quality?: GptImageQuality | null
  googleSearch?: boolean
  googleImageSearch?: boolean
}

export type AsyncImageTaskStatus = 'IN_PROGRESS' | 'SUCCESS' | 'FAILURE'

export interface AsyncImageTaskSubmission {
  taskId: string
}

export interface AsyncImageTaskQueryPendingResult {
  status: 'IN_PROGRESS'
}

export interface AsyncImageTaskQuerySuccessResult {
  status: 'SUCCESS'
  imageUrl: string
}

export interface AsyncImageTaskQueryFailureResult {
  status: 'FAILURE'
  errorMsg: string
}

export type AsyncImageTaskQueryResult =
  | AsyncImageTaskQueryPendingResult
  | AsyncImageTaskQuerySuccessResult
  | AsyncImageTaskQueryFailureResult
