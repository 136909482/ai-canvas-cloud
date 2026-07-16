import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessCheckpointAssetManifest,
  deriveCheckpointAssetManifest,
} from '../../dist/modules/project-snapshots/checkpointAssetManifestRepair.js'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ASSET_A = '11111111-1111-4111-8111-111111111111'
const ASSET_B = '22222222-2222-4222-8222-222222222222'

function record(nodes: unknown[]) {
  return {
    schemaVersion: 1,
    project: { id: PROJECT_ID, name: 'History', version: 1, lastSequence: 1 },
    canvas: { nodes, edges: [] },
    taskQueue: { tasks: [] },
  }
}

function node(id: string, data: Record<string, unknown>) {
  return {
    id,
    nodeType: 'imageNode',
    position: { x: 0, y: 0 },
    dataSchemaVersion: 1,
    data,
  }
}

test('historical checkpoint manifests derive sorted unique Cloud asset UUIDs', () => {
  const snapshot = record([
    node('node-b', {
      source: { assetId: ASSET_B.toUpperCase() },
      duplicate: { relativePath: `cloud-assets/${ASSET_B}` },
    }),
    node('node-a', {
      imageAsset: { relativePath: `cloud-assets/${ASSET_A}` },
      ignored: {
        signedUrl: `https://objects.example.test/${ASSET_B}`,
        objectKey: `workspaces/forged/assets/${ASSET_A}.png`,
        workspaceId: 'forged-workspace',
        userId: 'forged-user',
        dataUrl: 'data:image/png;base64,AAAA',
        blobUrl: 'blob:https://example.test/runtime-only',
      },
    }),
  ])

  assert.deepEqual(deriveCheckpointAssetManifest(snapshot, PROJECT_ID), [ASSET_A, ASSET_B])
})

test('historical empty, mismatched and duplicate manifests are explicitly repairable', () => {
  const snapshot = record([
    node('node-a', { imageAsset: { assetId: ASSET_A } }),
    node('node-b', { imageAsset: { assetId: ASSET_B } }),
  ])

  assert.deepEqual(assessCheckpointAssetManifest({
    projectId: PROJECT_ID,
    record: snapshot,
    storedManifest: [],
  }), { status: 'repairable', manifest: [ASSET_A, ASSET_B], reason: 'empty' })
  assert.deepEqual(assessCheckpointAssetManifest({
    projectId: PROJECT_ID,
    record: snapshot,
    storedManifest: [ASSET_A],
  }), { status: 'repairable', manifest: [ASSET_A, ASSET_B], reason: 'mismatch' })
  assert.deepEqual(assessCheckpointAssetManifest({
    projectId: PROJECT_ID,
    record: snapshot,
    storedManifest: [ASSET_B, ASSET_A, ASSET_A],
  }), { status: 'repairable', manifest: [ASSET_A, ASSET_B], reason: 'noncanonical' })
})

test('damaged records and malformed manifests are invalid rather than silently repaired', () => {
  assert.deepEqual(assessCheckpointAssetManifest({
    projectId: PROJECT_ID,
    record: { schemaVersion: 1, project: { id: PROJECT_ID }, canvas: { nodes: {} } },
    storedManifest: [],
  }), { status: 'invalid', reason: 'record_invalid' })
  assert.deepEqual(assessCheckpointAssetManifest({
    projectId: PROJECT_ID,
    record: record([]),
    storedManifest: ['not-an-asset-id'],
  }), { status: 'invalid', reason: 'manifest_invalid' })
})
