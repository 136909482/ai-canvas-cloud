import assert from 'node:assert/strict'
import test from 'node:test'
import type { Edge, Node } from '@xyflow/react'
import {
  canvasEdgeToProjectGraphEdge,
  canvasNodeToProjectGraphNode,
  diffCanvasSnapshots,
  projectGraphEdgeToCanvasEdge,
  projectGraphNodeToCanvasNode,
} from './cloudProjectGraph.ts'

test('cloud graph node mapping preserves relational and presentation fields', () => {
  const node: Node = {
    id: 'node-child',
    type: 'textNode',
    position: { x: 12, y: 24 },
    width: 320,
    height: 180,
    parentId: 'node-parent',
    zIndex: 3,
    selected: false,
    extent: 'parent',
    data: { text: 'hello' },
  }

  const graphNode = canvasNodeToProjectGraphNode(node)
  const restored = projectGraphNodeToCanvasNode(graphNode)

  assert.equal(graphNode.parentNodeId, 'node-parent')
  assert.deepEqual(graphNode.size, { width: 320, height: 180 })
  assert.equal(restored.parentId, 'node-parent')
  assert.equal(restored.extent, 'parent')
  assert.deepEqual(restored.data, { text: 'hello' })
})

test('cloud graph edge mapping preserves animated presentation separately from endpoints', () => {
  const edge: Edge = {
    id: 'edge-a-b',
    source: 'node-a',
    target: 'node-b',
    sourceHandle: 'output',
    targetHandle: 'input',
    animated: true,
    selected: false,
    data: { kind: 'image' },
  }

  const graphEdge = canvasEdgeToProjectGraphEdge(edge)
  const restored = projectGraphEdgeToCanvasEdge(graphEdge)

  assert.equal(restored.animated, true)
  assert.equal(restored.sourceHandle, 'output')
  assert.deepEqual(restored.data, { kind: 'image' })
})

test('cloud graph diff emits only ID-level node and edge changes', () => {
  const baselineNode: Node = {
    id: 'node-a',
    type: 'textNode',
    position: { x: 0, y: 0 },
    data: { first: 1, second: 2 },
  }
  const movedNode: Node = {
    ...baselineNode,
    position: { x: 100, y: 0 },
    data: { second: 2, first: 1 },
  }
  const edge: Edge = { id: 'edge-a-b', source: 'node-a', target: 'node-b', data: {} }

  assert.deepEqual(
    diffCanvasSnapshots(
      { nodes: [baselineNode], edges: [] },
      { nodes: [{ ...baselineNode, data: { second: 2, first: 1 } }], edges: [] },
    ),
    [],
  )

  const operations = diffCanvasSnapshots(
    { nodes: [baselineNode], edges: [edge] },
    { nodes: [movedNode], edges: [] },
  )

  assert.equal(operations.length, 2)
  assert.equal(operations[0]?.type, 'upsertNode')
  assert.deepEqual(operations[1], { type: 'deleteEdge', edgeId: 'edge-a-b' })
})
