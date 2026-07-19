import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalJsonStringify,
  parseCanonicalJson,
  validateMigrationArchiveEntries,
  validateMigrationPackageContract,
  validateCompleteMigrationImportAssetUploadRequest,
  validateCommitMigrationImportRequest,
  validatePrepareMigrationImportRequest,
  type MigrationPackageContractInput,
} from './migrationPackage.ts'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const ASSET_ID = 'asset-1'
const PROJECT_ID = 'project-1'

function snapshot() {
  return {
    schemaVersion: 1,
    canvas: {
      nodes: [{
        id: 'node-1',
        type: 'imageNode',
        position: { x: 10, y: 20 },
        data: {
          imageAsset: {
            assetId: ASSET_ID,
            relativePath: 'assets/asset-1.png',
            mimeType: 'image/png',
            fileName: 'source.png',
          },
        },
      }],
      edges: [],
    },
    taskQueue: { tasks: [] },
  }
}

function packageInput(overrides: Partial<MigrationPackageContractInput> = {}): MigrationPackageContractInput {
  const files = [
    { path: 'assets.json', byteSize: 20, sha256: HASH_A },
    { path: 'assets/asset-1.png', byteSize: 100, sha256: HASH_B },
    { path: 'graph.json', byteSize: 30, sha256: HASH_A },
    { path: 'project.json', byteSize: 40, sha256: HASH_B },
  ]
  return {
    manifest: {
      packageSchemaVersion: 1,
      packageId: 'package-1',
      sourcePlatform: 'electron',
      exportedAt: '2026-07-18T00:00:00.000Z',
      project: { id: PROJECT_ID, version: 3, sequence: 7 },
      fileCount: files.length,
      totalByteSize: 190,
      contentSha256: HASH_A,
      files,
    },
    projectRecord: {
      id: PROJECT_ID,
      name: 'Portable project',
      savedSnapshot: snapshot(),
      workingSnapshot: snapshot(),
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
      lastOpenedAt: '2026-07-18T00:00:00.000Z',
      archivedAt: null,
    },
    graph: {
      schemaVersion: 1,
      projectId: PROJECT_ID,
      version: 3,
      sequence: 7,
      nodes: [{
        id: 'node-1',
        nodeType: 'imageNode',
        position: { x: 10, y: 20 },
        dataSchemaVersion: 1,
        data: { assetId: ASSET_ID },
      }],
      edges: [],
    },
    assetManifest: {
      schemaVersion: 1,
      assets: [{
        logicalAssetId: ASSET_ID,
        filePath: 'assets/asset-1.png',
        originalFileName: 'source.png',
        mimeType: 'image/png',
        byteSize: 100,
        sha256: HASH_B,
        width: 1024,
        height: 768,
        assetKind: 'upload',
      }],
    },
    archiveEntries: [
      { path: 'assets.json', kind: 'file', uncompressedSize: 20, compressedSize: 20, sha256: HASH_A },
      { path: 'assets/asset-1.png', kind: 'file', uncompressedSize: 100, compressedSize: 100, sha256: HASH_B },
      { path: 'graph.json', kind: 'file', uncompressedSize: 30, compressedSize: 30, sha256: HASH_A },
      { path: 'manifest.json', kind: 'file', uncompressedSize: 10, compressedSize: 10, sha256: HASH_A },
      { path: 'project.json', kind: 'file', uncompressedSize: 40, compressedSize: 40, sha256: HASH_B },
    ],
    ...overrides,
  }
}

test('validates a canonical single-project package and freezes cross-file identity', () => {
  const validated = validateMigrationPackageContract(packageInput())

  assert.equal(validated.manifest.project.id, PROJECT_ID)
  assert.equal(validated.graph.sequence, 7)
  assert.equal(validated.assetManifest.assets[0]?.logicalAssetId, ASSET_ID)
  assert.equal(validated.checkpoint, null)
})

test('prepare import request accepts only the package contract and an idempotency key', () => {
  const validated = validatePrepareMigrationImportRequest({
    ...packageInput(),
    idempotencyKey: 'prepare-1',
  })
  assert.equal(validated.idempotencyKey, 'prepare-1')
  assert.equal(validated.manifest.packageId, 'package-1')

  assert.throws(() => validatePrepareMigrationImportRequest({
    ...packageInput(),
    idempotencyKey: 'prepare-1',
    userId: 'forged-user',
    workspaceId: 'forged-workspace',
  }), /unsupported field/i)
})

test('migration asset completion accepts empty bodies but rejects unsafe part fields', () => {
  assert.deepEqual(validateCompleteMigrationImportAssetUploadRequest(undefined), {})
  assert.deepEqual(validateCompleteMigrationImportAssetUploadRequest({}), {})
  assert.deepEqual(validateCompleteMigrationImportAssetUploadRequest({
    parts: { '1': { etag: 'etag-1', byteSize: 8 } },
  }), { parts: { '1': { etag: 'etag-1', byteSize: 8 } } })
  assert.throws(() => validateCompleteMigrationImportAssetUploadRequest({
    parts: { '0': { etag: 'etag-0', byteSize: 8 } },
  }), /Part number is invalid/)
  assert.throws(() => validateCompleteMigrationImportAssetUploadRequest({
    parts: { '1': { etag: 'etag-1', byteSize: 8, objectKey: 'forged' } },
  }), /unsupported field/i)
})

test('migration commit contract requires an explicit strategy and stable idempotency key', () => {
  assert.deepEqual(validateCommitMigrationImportRequest({
    idempotencyKey: 'commit-1',
    strategy: 'replace',
    expectedVersion: 2,
    expectedSequence: 3,
    confirmReplace: true,
  }), {
    idempotencyKey: 'commit-1',
    strategy: 'replace',
    expectedVersion: 2,
    expectedSequence: 3,
    confirmReplace: true,
  })
  assert.throws(() => validateCommitMigrationImportRequest({
    idempotencyKey: 'commit-1',
    strategy: 'replace',
    objectKey: 'forged',
  }), /unsupported field/i)
})

test('canonical JSON has stable keys and rejects non-canonical text', () => {
  assert.equal(canonicalJsonStringify({ b: 1, a: 'x' }), '{"a":"x","b":1}')
  assert.deepEqual(parseCanonicalJson('{"a":"x","b":1}'), { a: 'x', b: 1 })
  assert.throws(() => parseCanonicalJson('{ "b": 1, "a": "x" }'), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'NON_CANONICAL'
  ))
})

test('canonical JSON rejects duplicate object keys, including escaped aliases', () => {
  assert.throws(
    () => parseCanonicalJson('{"a":1,"a":2}'),
    /duplicate object keys/i,
  )
  assert.throws(
    () => parseCanonicalJson('{"a":1,"\\u0061":2}'),
    /duplicate object keys/i,
  )
})

test('rejects unknown schema, path traversal, duplicate paths, and symlinks', () => {
  assert.throws(() => validateMigrationPackageContract({
    ...packageInput(),
    manifest: { ...packageInput().manifest, packageSchemaVersion: 2 },
  }), /Unsupported migration package schema version/)
  assert.throws(() => validateMigrationArchiveEntries([
    { path: '../project.json', kind: 'file', uncompressedSize: 1, compressedSize: 1 },
  ]), /canonical relative ASCII paths/)
  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'project.json', kind: 'file', uncompressedSize: 1, compressedSize: 1 },
    { path: 'PROJECT.JSON', kind: 'file', uncompressedSize: 1, compressedSize: 1 },
  ]), /duplicate path/i)
  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'project.json', kind: 'symlink', uncompressedSize: 0, compressedSize: 0 },
  ]), /Symbolic links/)
})

test('rejects compressed bombs and package limits before extraction', () => {
  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'project.json', kind: 'file', uncompressedSize: 101, compressedSize: 1 },
  ]), /compression ratio limit/)
  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'project.json', kind: 'file', uncompressedSize: 10, compressedSize: 10 },
    { path: 'graph.json', kind: 'file', uncompressedSize: 10, compressedSize: 10 },
  ], { maxFileCount: 1 }), /file count/i)
  assert.throws(() => validateMigrationArchiveEntries([
    { path: 'a/b/project.json', kind: 'file', uncompressedSize: 10, compressedSize: 10 },
  ], { maxDirectoryDepth: 1 }), /compression ratio|depth/i)
})

test('rejects duplicate logical assets, dangling references, and mismatched metadata', () => {
  const duplicateAssets = packageInput()
  duplicateAssets.assetManifest = {
    schemaVersion: 1,
    assets: [
      { ...packageInput().assetManifest.assets[0]! },
      { ...packageInput().assetManifest.assets[0]! },
    ],
  }
  assert.throws(() => validateMigrationPackageContract(duplicateAssets), /duplicate value/i)

  const dangling = packageInput()
  dangling.graph = {
    ...packageInput().graph,
    nodes: [{
      ...packageInput().graph.nodes[0]!,
      data: { assetId: 'missing-asset' },
    }],
  }
  assert.throws(() => validateMigrationPackageContract(dangling), /referenced but not declared/i)

  const mismatched = packageInput()
  mismatched.manifest = {
    ...packageInput().manifest,
    files: packageInput().manifest.files.map((file) => file.path === 'assets/asset-1.png'
      ? { ...file, byteSize: 101 }
      : file),
    totalByteSize: 191,
  }
  assert.throws(() => validateMigrationPackageContract(mismatched), /Asset metadata does not match/i)

  const unsafeFileName = packageInput()
  unsafeFileName.assetManifest = {
    ...packageInput().assetManifest,
    assets: [{ ...packageInput().assetManifest.assets[0]!, originalFileName: '../source.png' }],
  }
  assert.throws(() => validateMigrationPackageContract(unsafeFileName), /must be a file name/i)
})

test('rejects credentials, tenant internals, and persistent URLs in package JSON', () => {
  const sensitive = packageInput()
  sensitive.graph = {
    ...packageInput().graph,
    nodes: [{
      ...packageInput().graph.nodes[0]!,
      data: { apiKey: 'secret' },
    }],
  }
  assert.throws(() => validateMigrationPackageContract(sensitive), /forbidden internal or credential field/i)

  const url = packageInput()
  url.graph = {
    ...packageInput().graph,
    nodes: [{
      ...packageInput().graph.nodes[0]!,
      data: { imageUrl: 'https://example.invalid/image.png' },
    }],
  }
  assert.throws(() => validateMigrationPackageContract(url), /persistent external/i)
})

test('rejects non-canonical manifest ordering and dangling checkpoint assets', () => {
  const unordered = packageInput()
  unordered.manifest = {
    ...packageInput().manifest,
    files: [...packageInput().manifest.files].reverse(),
  }
  assert.throws(() => validateMigrationPackageContract(unordered), /stable ascending order/)

  const checkpoint = packageInput({
    checkpoint: {
      schemaVersion: 1,
      id: 'checkpoint-1',
      projectId: PROJECT_ID,
      projectVersion: 3,
      sequence: 7,
      checkpointType: 'import',
      createdAt: '2026-07-18T00:00:00.000Z',
      assetIds: ['missing-asset'],
      record: {
        schemaVersion: 1,
        project: { id: PROJECT_ID, name: 'Portable project', version: 3, lastSequence: 7 },
        canvas: { nodes: [], edges: [] },
        taskQueue: { tasks: [] },
      },
    },
  })
  checkpoint.manifest = {
    ...packageInput().manifest,
    fileCount: 5,
    totalByteSize: 200,
    files: [
      { path: 'assets.json', byteSize: 20, sha256: HASH_A },
      { path: 'assets/asset-1.png', byteSize: 100, sha256: HASH_B },
      { path: 'checkpoint.json', byteSize: 10, sha256: HASH_A },
      { path: 'graph.json', byteSize: 30, sha256: HASH_A },
      { path: 'project.json', byteSize: 40, sha256: HASH_B },
    ],
  }
  checkpoint.archiveEntries = [
    { path: 'assets.json', kind: 'file', uncompressedSize: 20, compressedSize: 20, sha256: HASH_A },
    { path: 'assets/asset-1.png', kind: 'file', uncompressedSize: 100, compressedSize: 100, sha256: HASH_B },
    { path: 'checkpoint.json', kind: 'file', uncompressedSize: 10, compressedSize: 10, sha256: HASH_A },
    { path: 'graph.json', kind: 'file', uncompressedSize: 30, compressedSize: 30, sha256: HASH_A },
    { path: 'manifest.json', kind: 'file', uncompressedSize: 10, compressedSize: 10, sha256: HASH_A },
    { path: 'project.json', kind: 'file', uncompressedSize: 40, compressedSize: 40, sha256: HASH_B },
  ]
  assert.throws(() => validateMigrationPackageContract(checkpoint), /Checkpoint asset IDs must match/i)
})
