import assert from 'node:assert/strict'
import test from 'node:test'
import { filterTaskQueueTasks } from './taskQueueView.ts'
import type { GenerateTask } from '@/types'

function task(id: string, status: GenerateTask['status']): GenerateTask {
  return {
    id,
    displayId: id,
    projectId: 'project-1',
    kind: 'image',
    sourceNodeId: 'source-1',
    previewNodeId: 'preview-1',
    model: 'gpt-image-2',
    prompt: '',
    negativePrompt: '',
    ratio: '1:1',
    resolution: '1K',
    operationType: 'text-to-image',
    sourceImageNodeId: null,
    maskImageUrl: null,
    apiProfileId: null,
    apiProfileName: null,
    provider: 'openai',
    referenceImageUrls: [],
    inputFidelity: null,
    quality: null,
    googleSearch: false,
    googleImageSearch: false,
    videoMode: null,
    videoDuration: null,
    resultImageAsset: null,
    resultVideoAsset: null,
    status,
    errorMsg: '',
    remoteTaskId: null,
    remoteStatus: null,
    createdAt: 1,
    startedAt: 0,
    finishedAt: null,
  }
}

test('task queue filters preserve active and finished task boundaries', () => {
  const tasks = [task('queued', 'queued'), task('running', 'running'), task('done', 'done'), task('error', 'error')]

  assert.deepEqual(filterTaskQueueTasks(tasks, 'all').map((item) => item.id), ['queued', 'running', 'done', 'error'])
  assert.deepEqual(filterTaskQueueTasks(tasks, 'active').map((item) => item.id), ['queued', 'running'])
  assert.deepEqual(filterTaskQueueTasks(tasks, 'finished').map((item) => item.id), ['done', 'error'])
})
