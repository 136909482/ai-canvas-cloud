import type {
  GenerationTaskExecutionService,
  GenerationTaskLease,
  ProviderAdapter,
  ProviderCredentialService,
  TaskInputObjectStorage,
  TaskResultObjectStorage,
} from '@ai-canvas-cloud/server'
import type { MetricsRegistry } from '@ai-canvas-cloud/shared'
import {
  ProviderGatewayError,
  storeProviderTaskResultBytes,
  TaskResultTransferError,
  transferProviderTaskResult,
  type TaskResultAsset,
} from '@ai-canvas-cloud/server'
import type { GenerationTaskProcessor, GenerationTaskProcessorContext } from './taskConsumer.js'
import { GenerationTaskProcessingError } from './taskConsumer.js'

function providerFailure(error: ProviderGatewayError) {
  if (error.category === 'authentication') {
    return new GenerationTaskProcessingError('PROVIDER_CONFIG_INVALID', 'Provider credential was rejected', false)
  }
  if (error.category === 'rejected' || error.category === 'redirect' || error.category === 'response_too_large') {
    return new GenerationTaskProcessingError('PROVIDER_RESPONSE_REJECTED', 'Provider rejected the image generation request', false)
  }
  return new GenerationTaskProcessingError(
    error.category === 'timeout' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
    'Provider image generation is temporarily unavailable',
    true,
  )
}

function transferFailure(error: TaskResultTransferError) {
  return new GenerationTaskProcessingError(
    error.code,
    error.code === 'RESULT_RATE_LIMITED'
      ? 'Provider result download is rate limited'
      : 'Provider result could not be transferred safely',
    error.code === 'RESULT_RATE_LIMITED' || error.code === 'RESULT_DOWNLOAD_FAILED' || error.code === 'RESULT_TRANSFER_FAILED',
  )
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new GenerationTaskProcessingError('TASK_ABORTED', 'Task execution was interrupted', true)
  }
}

export function createSynchronousOpenAiImageTaskProcessor(options: {
  executionService: GenerationTaskExecutionService
  providerCredentialService: Pick<ProviderCredentialService, 'getExecutionCredential'>
  providerAdapter: Pick<ProviderAdapter, 'generateImage' | 'editImage' | 'supportsIdempotentSubmission'>
  objectStorage: TaskResultObjectStorage & TaskInputObjectStorage
  metrics?: MetricsRegistry
}): GenerationTaskProcessor {
  return {
    async process(lease: GenerationTaskLease, context: GenerationTaskProcessorContext) {
      if (lease.kind !== 'image') {
        throw new GenerationTaskProcessingError('TASK_CAPABILITY_UNSUPPORTED', 'Task capability is not enabled', false)
      }
      const decision = await options.executionService.prepareProviderSubmission({
        taskId: lease.taskId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        supportsIdempotentSubmission: options.providerAdapter.supportsIdempotentSubmission('openai'),
      })
      if (!decision) {
        return
      }
      if (decision.action === 'uncertain') {
        throw new GenerationTaskProcessingError(
          'PROVIDER_SUBMISSION_UNCERTAIN',
          'Provider submission outcome cannot be retried automatically',
          false,
        )
      }
      if (decision.action === 'poll') {
        throw new GenerationTaskProcessingError('PROVIDER_PROTOCOL_UNSUPPORTED', 'Synchronous image task cannot poll a remote task', false)
      }

      await context.reportProgress(10)
      assertNotAborted(context.signal)
      const credential = await options.providerCredentialService.getExecutionCredential({
        userId: lease.createdByUserId,
        providerId: lease.providerId,
      })
      let providerResult: Awaited<ReturnType<ProviderAdapter['generateImage']>>
      try {
        if (lease.parameters.operationType === 'image-edit') {
          const source = await options.executionService.getSourceAsset({ taskId: lease.taskId, workerId: lease.workerId, leaseToken: lease.leaseToken })
          if (!source) throw new GenerationTaskProcessingError('TASK_INPUT_ASSET_MISSING', 'Task source asset is not available', false)
          const image = await options.objectStorage.getObjectBytes({ objectKey: source.objectKey, maxBytes: 50 * 1024 * 1024 })
          providerResult = await options.providerAdapter.editImage({ providerId: credential.providerId, providerType: credential.providerType, baseUrl: credential.baseUrl, apiKey: credential.apiKey, model: lease.model, parameters: lease.parameters, image, mimeType: source.mimeType, signal: context.signal })
        } else {
          providerResult = await options.providerAdapter.generateImage({
            providerId: credential.providerId, providerType: credential.providerType, baseUrl: credential.baseUrl, apiKey: credential.apiKey, model: lease.model, parameters: lease.parameters, signal: context.signal,
          })
        }
      } catch (error) {
        if (error instanceof ProviderGatewayError) {
          throw providerFailure(error)
        }
        throw error
      }
      await context.reportProgress(65)
      assertNotAborted(context.signal)
      let resultAsset
      try {
        resultAsset = await storeProviderTaskResultBytes({
          workspaceId: lease.workspaceId,
          projectId: lease.projectId,
          taskId: lease.taskId,
          resultIndex: 0,
          objectStorage: options.objectStorage,
          mimeType: providerResult.mimeType,
          body: providerResult.imageBytes,
          metrics: options.metrics,
        })
      } catch (error) {
        if (error instanceof TaskResultTransferError) {
          throw transferFailure(error)
        }
        throw error
      }
      await context.reportProgress(90)
      assertNotAborted(context.signal)
      await options.executionService.settleSuccess({
        taskId: lease.taskId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        resultAssets: [resultAsset],
        usage: providerResult.usage,
      })
    },
  }
}

function sleepUntilNextPoll(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, ms)
    const aborted = () => {
      clearTimeout(timeout)
      reject(new GenerationTaskProcessingError('TASK_ABORTED', 'Task execution was interrupted', true))
    }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

export function createAliyunAsyncImageTaskProcessor(options: {
  executionService: GenerationTaskExecutionService
  providerCredentialService: Pick<ProviderCredentialService, 'getExecutionCredential'>
  providerAdapter: Pick<ProviderAdapter, 'pollAliyunImageTask' | 'submitAliyunImageTask' | 'supportsIdempotentSubmission'>
  objectStorage: TaskResultObjectStorage
  metrics?: MetricsRegistry
  pollIntervalMs?: number
  pollTimeoutMs?: number
  transferResult?: (input: Parameters<typeof transferProviderTaskResult>[0]) => Promise<TaskResultAsset>
}): GenerationTaskProcessor {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  const pollTimeoutMs = options.pollTimeoutMs ?? 30 * 60 * 1_000
  const transferResult = options.transferResult ?? transferProviderTaskResult
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || !Number.isSafeInteger(pollTimeoutMs) || pollTimeoutMs < 1) {
    throw new Error('Aliyun polling durations are invalid')
  }
  return {
    async process(lease, context) {
      if (lease.kind !== 'image' || lease.providerId !== 'aliyun' || lease.model !== 'wanx2.1-t2i-turbo' || lease.parameters.operationType === 'image-edit') {
        throw new GenerationTaskProcessingError('TASK_CAPABILITY_UNSUPPORTED', 'Task capability is not enabled', false)
      }
      const decision = await options.executionService.prepareProviderSubmission({
        taskId: lease.taskId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        supportsIdempotentSubmission: options.providerAdapter.supportsIdempotentSubmission('aliyun'),
      })
      if (!decision) return
      if (decision.action === 'uncertain') {
        throw new GenerationTaskProcessingError('PROVIDER_SUBMISSION_UNCERTAIN', 'Provider submission outcome cannot be retried automatically', false)
      }
      await context.reportProgress(10)
      assertNotAborted(context.signal)
      const credential = await options.providerCredentialService.getExecutionCredential({
        userId: lease.createdByUserId,
        providerId: 'aliyun',
      })
      let remoteTaskId: string
      try {
        if (decision.action === 'poll') {
          remoteTaskId = decision.remoteTaskId
        } else {
          remoteTaskId = (await options.providerAdapter.submitAliyunImageTask({
            providerId: credential.providerId, providerType: credential.providerType, baseUrl: credential.baseUrl,
            apiKey: credential.apiKey,
            model: lease.model,
            parameters: lease.parameters,
            signal: context.signal,
          })).remoteTaskId
          const recorded = await options.executionService.recordProviderSubmission({
            taskId: lease.taskId,
            workerId: lease.workerId,
            leaseToken: lease.leaseToken,
            remoteTaskId,
          })
          if (!recorded.recorded) {
            throw new GenerationTaskProcessingError('TASK_LEASE_LOST', 'Provider task was accepted after lease loss', true)
          }
        }
      } catch (error) {
        if (error instanceof ProviderGatewayError) throw providerFailure(error)
        throw error
      }

      const pollingStartedAt = Date.now()
      while (true) {
        assertNotAborted(context.signal)
        let status: Awaited<ReturnType<ProviderAdapter['pollAliyunImageTask']>>
        try {
          status = await options.providerAdapter.pollAliyunImageTask({
            providerId: credential.providerId, providerType: credential.providerType, baseUrl: credential.baseUrl,
            apiKey: credential.apiKey,
            remoteTaskId,
            signal: context.signal,
          })
        } catch (error) {
          if (error instanceof ProviderGatewayError) throw providerFailure(error)
          throw error
        }
        if (status.status === 'failed') {
          throw new GenerationTaskProcessingError('PROVIDER_TASK_FAILED', 'Provider image task failed', false)
        }
        if (status.status === 'succeeded') {
          let resultAsset: TaskResultAsset
          try {
            resultAsset = await transferResult({
              providerId: 'aliyun', resultUrl: status.resultUrl,
              workspaceId: lease.workspaceId, projectId: lease.projectId, taskId: lease.taskId,
              resultIndex: 0, objectStorage: options.objectStorage,
              metrics: options.metrics,
            })
          } catch (error) {
            if (error instanceof TaskResultTransferError) throw transferFailure(error)
            throw error
          }
          await context.reportProgress(90)
          assertNotAborted(context.signal)
          await options.executionService.settleSuccess({
            taskId: lease.taskId, workerId: lease.workerId, leaseToken: lease.leaseToken,
            resultAssets: [resultAsset], usage: {},
          })
          return
        }
        if (Date.now() - pollingStartedAt >= pollTimeoutMs) {
          throw new GenerationTaskProcessingError('PROVIDER_TIMEOUT', 'Provider image task polling timed out', true)
        }
        await context.reportProgress(45)
        await sleepUntilNextPoll(pollIntervalMs, context.signal)
      }
    },
  }
}

export function createAliyunAsyncVideoTaskProcessor(options: {
  executionService: GenerationTaskExecutionService
  providerCredentialService: Pick<ProviderCredentialService, 'getExecutionCredential'>
  providerAdapter: Pick<ProviderAdapter, 'pollAliyunVideoTask' | 'submitAliyunVideoTask' | 'supportsIdempotentSubmission'>
  objectStorage: TaskResultObjectStorage
  metrics?: MetricsRegistry
  pollIntervalMs?: number
  pollTimeoutMs?: number
  transferResult?: (input: Parameters<typeof transferProviderTaskResult>[0]) => Promise<TaskResultAsset>
}): GenerationTaskProcessor {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  const pollTimeoutMs = options.pollTimeoutMs ?? 30 * 60 * 1_000
  const transferResult = options.transferResult ?? transferProviderTaskResult
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || !Number.isSafeInteger(pollTimeoutMs) || pollTimeoutMs < 1) {
    throw new Error('Aliyun polling durations are invalid')
  }
  return {
    async process(lease, context) {
      if (lease.kind !== 'video' || lease.providerId !== 'aliyun' || lease.model !== 'wan2.7-t2v') {
        throw new GenerationTaskProcessingError('TASK_CAPABILITY_UNSUPPORTED', 'Task capability is not enabled', false)
      }
      const decision = await options.executionService.prepareProviderSubmission({
        taskId: lease.taskId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        supportsIdempotentSubmission: options.providerAdapter.supportsIdempotentSubmission('aliyun'),
      })
      if (!decision) return
      if (decision.action === 'uncertain') {
        throw new GenerationTaskProcessingError('PROVIDER_SUBMISSION_UNCERTAIN', 'Provider submission outcome cannot be retried automatically', false)
      }
      await context.reportProgress(10)
      assertNotAborted(context.signal)
      const credential = await options.providerCredentialService.getExecutionCredential({
        userId: lease.createdByUserId,
        providerId: 'aliyun',
      })
      let remoteTaskId: string
      try {
        if (decision.action === 'poll') {
          remoteTaskId = decision.remoteTaskId
        } else {
          remoteTaskId = (await options.providerAdapter.submitAliyunVideoTask({
            providerId: credential.providerId, providerType: credential.providerType, baseUrl: credential.baseUrl,
            apiKey: credential.apiKey,
            model: lease.model,
            parameters: lease.parameters,
            signal: context.signal,
          })).remoteTaskId
          const recorded = await options.executionService.recordProviderSubmission({
            taskId: lease.taskId,
            workerId: lease.workerId,
            leaseToken: lease.leaseToken,
            remoteTaskId,
          })
          if (!recorded.recorded) {
            throw new GenerationTaskProcessingError('TASK_LEASE_LOST', 'Provider task was accepted after lease loss', true)
          }
        }
      } catch (error) {
        if (error instanceof ProviderGatewayError) throw providerFailure(error)
        throw error
      }

      const pollingStartedAt = Date.now()
      while (true) {
        assertNotAborted(context.signal)
        let status: Awaited<ReturnType<ProviderAdapter['pollAliyunVideoTask']>>
        try {
          status = await options.providerAdapter.pollAliyunVideoTask({
            providerId: credential.providerId, providerType: credential.providerType, baseUrl: credential.baseUrl,
            apiKey: credential.apiKey,
            remoteTaskId,
            signal: context.signal,
          })
        } catch (error) {
          if (error instanceof ProviderGatewayError) throw providerFailure(error)
          throw error
        }
        if (status.status === 'failed') {
          throw new GenerationTaskProcessingError('PROVIDER_TASK_FAILED', 'Provider video task failed', false)
        }
        if (status.status === 'succeeded') {
          let resultAsset: TaskResultAsset
          try {
            resultAsset = await transferResult({
              providerId: 'aliyun', resultUrl: status.resultUrl,
              workspaceId: lease.workspaceId, projectId: lease.projectId, taskId: lease.taskId,
              resultIndex: 0, objectStorage: options.objectStorage,
              metrics: options.metrics,
            })
          } catch (error) {
            if (error instanceof TaskResultTransferError) throw transferFailure(error)
            throw error
          }
          await context.reportProgress(90)
          assertNotAborted(context.signal)
          await options.executionService.settleSuccess({
            taskId: lease.taskId, workerId: lease.workerId, leaseToken: lease.leaseToken,
            resultAssets: [resultAsset], usage: {},
          })
          return
        }
        if (Date.now() - pollingStartedAt >= pollTimeoutMs) {
          throw new GenerationTaskProcessingError('PROVIDER_TIMEOUT', 'Provider video task polling timed out', true)
        }
        await context.reportProgress(45)
        await sleepUntilNextPoll(pollIntervalMs, context.signal)
      }
    },
  }
}

export function createProviderImageTaskProcessor(options: {
  executionService: GenerationTaskExecutionService
  providerCredentialService: Pick<ProviderCredentialService, 'getExecutionCredential'>
  providerAdapter: ProviderAdapter
  objectStorage: TaskResultObjectStorage & TaskInputObjectStorage
  metrics?: MetricsRegistry
}): GenerationTaskProcessor {
  const openAi = createSynchronousOpenAiImageTaskProcessor(options)
  const aliyun = createAliyunAsyncImageTaskProcessor(options)
  const aliyunVideo = createAliyunAsyncVideoTaskProcessor(options)
  return {
    process(lease, context) {
      return lease.providerId === 'aliyun' && lease.kind === 'image'
          ? aliyun.process(lease, context)
          : lease.providerId === 'aliyun' && lease.kind === 'video'
            ? aliyunVideo.process(lease, context)
            : lease.kind === 'image'
              ? openAi.process(lease, context)
              : Promise.reject(new GenerationTaskProcessingError('TASK_CAPABILITY_UNSUPPORTED', 'Task capability is not enabled', false))
    },
  }
}
