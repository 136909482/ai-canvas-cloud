import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertGenerationTaskTransition,
  canTransitionGenerationTask,
  isGenerationTaskTerminal,
  normalizeGenerationTaskProgress,
} from '../../dist/modules/tasks/stateMachine.js'

test('generation task state machine allows claims, recovery, retry, and terminal completion', () => {
  assert.equal(canTransitionGenerationTask('queued', 'running'), true)
  assert.equal(canTransitionGenerationTask('running', 'queued'), true)
  assert.equal(canTransitionGenerationTask('running', 'succeeded'), true)
  assert.equal(canTransitionGenerationTask('running', 'failed'), true)
  assert.equal(canTransitionGenerationTask('failed', 'queued'), true)
  assert.equal(canTransitionGenerationTask('queued', 'canceled'), true)
  assert.doesNotThrow(() => assertGenerationTaskTransition('running', 'running'))
})

test('generation task state machine keeps succeeded and canceled terminal', () => {
  assert.equal(isGenerationTaskTerminal('succeeded'), true)
  assert.equal(isGenerationTaskTerminal('failed'), true)
  assert.equal(isGenerationTaskTerminal('canceled'), true)
  assert.equal(isGenerationTaskTerminal('running'), false)
  assert.throws(() => assertGenerationTaskTransition('succeeded', 'queued'))
  assert.throws(() => assertGenerationTaskTransition('canceled', 'running'))
  assert.throws(() => assertGenerationTaskTransition('queued', 'succeeded'))
})

test('generation task progress is finite, integral, and bounded', () => {
  assert.equal(normalizeGenerationTaskProgress(27.6), 28)
  assert.equal(normalizeGenerationTaskProgress(-5), 0)
  assert.equal(normalizeGenerationTaskProgress(120), 100)
  assert.throws(() => normalizeGenerationTaskProgress(Number.NaN))
})
