import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const presentationFiles = [
  'apps/web/src/App.tsx',
  'apps/web/src/components/ProjectManagerDialog.tsx',
  'apps/web/src/components/StorageSettingsDialog.tsx',
  'apps/web/src/features/auth/AccountMenu.tsx',
  'apps/web/src/features/auth/AuthGate.tsx',
  'apps/web/src/features/auth/PublicHome.tsx',
]

test('Cloud presentation keeps the implicit personal workspace out of user-facing copy', async () => {
  const source = (await Promise.all(
    presentationFiles.map((filePath) => readFile(join(process.cwd(), filePath), 'utf8')),
  )).join('\n')

  assert.doesNotMatch(source, /工作区|个人空间|云空间|选择保存位置|session\.workspace\.name/)
})
