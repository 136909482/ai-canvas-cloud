import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalJsonStringify,
  validateMigrationArchiveEntries,
  validateMigrationPackagePath,
} from '@ai-canvas-cloud/contracts'

test('security archive and JSON matrix rejects traversal, encoding aliases, ZIP bombs and deep values', () => {
  for (const path of [
    '../secret.json',
    'assets/../secret.png',
    'assets/%2e%2e/secret.png',
    'assets\\secret.png',
    '/absolute/path',
    'C:/windows/path',
    'assets//duplicate.png',
    'assets/secret.png\0tail',
  ]) {
    assert.throws(() => validateMigrationPackagePath(path), undefined, path)
  }

  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'assets/a.png', kind: 'file', compressedSize: 1, uncompressedSize: 10_000 },
  ], { maxCompressionRatio: 10 }), /compression ratio/i)
  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'assets/A.png', kind: 'file', compressedSize: 1, uncompressedSize: 1 },
    { path: 'assets/a.png', kind: 'file', compressedSize: 1, uncompressedSize: 1 },
  ]), /duplicate path/i)

  let deep: Record<string, unknown> = { leaf: true }
  for (let index = 0; index < 70; index += 1) deep = { nested: deep }
  assert.throws(() => canonicalJsonStringify(deep), /depth limit/i)
  assert.throws(() => canonicalJsonStringify({ imageUrl: 'data:image/png;base64,AAAA' }), /persistent external/i)
  assert.throws(() => canonicalJsonStringify({ mediaUrls: ['blob:https://web.invalid/fixture'] }), /persistent external/i)
  assert.throws(() => canonicalJsonStringify({ value: '\ud800' }), /surrogate/i)
})
