import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasSnapshot } from '@/types'
import { hasGraphDeletion } from './projectAutosave.ts'

function snapshot(nodeIds: string[], edgeIds: string[] = []): CanvasSnapshot {
  return {
    nodes: nodeIds.map((id, index) => ({ id, type: 'textNode', position: { x: index * 100, y: 0 }, data: {} })),
    edges: edgeIds.map((id, index) => ({ id, source: nodeIds[index] ?? nodeIds[0] ?? 'a', target: nodeIds[index + 1] ?? nodeIds[0] ?? 'a' })),
  }
}

test('detects node and edge deletion for immediate autosave', () => {
  assert.equal(hasGraphDeletion(snapshot(['a']), snapshot(['a', 'b'])), true)
  assert.equal(hasGraphDeletion(snapshot(['a', 'b']), snapshot(['a', 'b'], ['edge-a-b'])), true)
})

test('does not treat additions or updates as deletion', () => {
  assert.equal(hasGraphDeletion(snapshot(['a', 'b']), snapshot(['a'])), false)
  assert.equal(hasGraphDeletion(snapshot(['a']), snapshot(['a'])), false)
})
