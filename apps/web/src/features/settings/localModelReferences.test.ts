import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLocalModelReference,
  findLocalModelReference,
  isLocalModelReference,
  normalizeLocalModelBindings,
  resolveLocalModelReference,
} from './localModelReferences.ts'
import { useSettingsStore } from '@/store/useSettingsStore.ts'

test('local model references are opaque UUID aliases with normalized Vault bindings', () => {
  const reference = createLocalModelReference()
  assert.equal(isLocalModelReference(reference), true)

  const bindings = normalizeLocalModelBindings({
    [reference]: '  private-model-id  ',
    'local:not-a-uuid': 'ignored-model',
    [createLocalModelReference()]: '',
  })

  assert.deepEqual(bindings, { [reference]: 'private-model-id' })
  assert.equal(resolveLocalModelReference(bindings, reference), 'private-model-id')
  assert.equal(findLocalModelReference(bindings, 'private-model-id'), reference)
})

test('an unbound local model reference remains explicitly unavailable', () => {
  const reference = createLocalModelReference()
  assert.equal(resolveLocalModelReference({}, reference), null)
  assert.equal(resolveLocalModelReference({}, 'legacy-public-model'), 'legacy-public-model')
})

test('manual device binding keeps the existing anonymous Cloud reference', () => {
  const reference = createLocalModelReference()
  const originalConfig = structuredClone(useSettingsStore.getState().config)

  try {
    useSettingsStore.getState().saveCustomModel({
      id: 'local-image-model',
      name: 'Local Image Model',
      modelId: 'private-image-model',
      kind: 'image',
      enabled: true,
      testStatus: 'idle',
      testMessage: '',
      lastTestedAt: null,
    })

    assert.equal(useSettingsStore.getState().bindLocalModelReference(reference, 'private-image-model'), true)
    assert.equal(useSettingsStore.getState().resolveLocalModelReference(reference), 'private-image-model')
    assert.equal(useSettingsStore.getState().ensureLocalModelReference('private-image-model'), reference)
    assert.equal(useSettingsStore.getState().bindLocalModelReference(reference, 'missing-model'), false)
  } finally {
    useSettingsStore.setState({ config: originalConfig })
  }
})
