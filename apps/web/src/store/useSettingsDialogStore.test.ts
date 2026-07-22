import assert from 'node:assert/strict'
import test from 'node:test'
import { EXPOSED_SETTINGS_CATEGORY_IDS, useSettingsDialogStore } from './useSettingsDialogStore.ts'

test('completed Vault settings are exposed while local task settings stay hidden', () => {
  assert.deepEqual(
    EXPOSED_SETTINGS_CATEGORY_IDS,
    ['account', 'devices', 'models', 'storage', 'canvas', 'appearance'],
  )

  const store = useSettingsDialogStore.getState()
  assert.equal(store.activeCategory, 'account')
  store.open('models')
  assert.equal(useSettingsDialogStore.getState().activeCategory, 'models')
  store.setActiveCategory('tasks')
  assert.equal(useSettingsDialogStore.getState().activeCategory, 'account')
  useSettingsDialogStore.getState().close()
})
