import assert from 'node:assert/strict'
import test from 'node:test'
import { applyProjectGraphOperations, createEmptyProjectGraph } from './index.ts'

test('project graph operations upsert and delete nodes with dependent edges', () => {
  const first = applyProjectGraphOperations(createEmptyProjectGraph(), [
    {
      type: 'upsertNode',
      node: {
        id: 'node_a',
        nodeType: 'text',
        position: { x: 0, y: 0 },
        dataSchemaVersion: 1,
        data: {},
      },
    },
    {
      type: 'upsertNode',
      node: {
        id: 'node_b',
        nodeType: 'text',
        position: { x: 120, y: 0 },
        dataSchemaVersion: 1,
        data: {},
      },
    },
    {
      type: 'upsertEdge',
      edge: {
        id: 'edge_ab',
        source: 'node_a',
        target: 'node_b',
      },
    },
  ])

  assert.equal(first.version, 1)
  assert.equal(first.nodes.length, 2)
  assert.equal(first.edges.length, 1)

  const second = applyProjectGraphOperations(first, [{ type: 'deleteNode', nodeId: 'node_a' }])

  assert.equal(second.version, 2)
  assert.deepEqual(second.nodes.map((node) => node.id), ['node_b'])
  assert.equal(second.edges.length, 0)
})
