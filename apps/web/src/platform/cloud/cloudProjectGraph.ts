import type { Edge, Node } from '@xyflow/react'
import type {
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphOperation,
  ProjectGraphResponse,
} from '@ai-canvas-cloud/contracts'
import type { CanvasSnapshot } from '@/types'

const EDGE_ENVELOPE_KEY = '__aiCanvasCloudEdge'

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    )
  }
  return value
}

function stableSerialize(value: unknown) {
  return JSON.stringify(stableValue(value))
}

export function canvasNodeToProjectGraphNode(node: Node): ProjectGraphNode {
  const {
    id,
    type,
    position,
    data,
    width,
    height,
    parentId,
    zIndex,
    ...presentation
  } = node
  const hasSize = typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0

  return cloneSerializable({
    id,
    nodeType: type ?? 'default',
    position,
    ...(hasSize ? { size: { width, height } } : {}),
    ...(typeof zIndex === 'number' ? { zIndex } : {}),
    parentNodeId: parentId ?? null,
    dataSchemaVersion: 1,
    data: asRecord(data),
    presentation,
  })
}

export function projectGraphNodeToCanvasNode(node: ProjectGraphNode): Node {
  return {
    ...cloneSerializable(node.presentation ?? {}),
    id: node.id,
    type: node.nodeType,
    position: cloneSerializable(node.position),
    data: cloneSerializable(node.data),
    ...(node.size ? { width: node.size.width, height: node.size.height } : {}),
    ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
    ...(node.parentNodeId ? { parentId: node.parentNodeId } : {}),
  } as Node
}

export function canvasEdgeToProjectGraphEdge(edge: Edge): ProjectGraphEdge {
  const {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type,
    data,
    ...presentation
  } = edge

  return cloneSerializable({
    id,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    edgeType: type ?? null,
    data: {
      [EDGE_ENVELOPE_KEY]: {
        schemaVersion: 1,
        data: asRecord(data),
        presentation,
      },
    },
  })
}

export function projectGraphEdgeToCanvasEdge(edge: ProjectGraphEdge): Edge {
  const envelope = asRecord(edge.data)[EDGE_ENVELOPE_KEY]
  const envelopeRecord = asRecord(envelope)
  const isEnvelope = envelopeRecord.schemaVersion === 1
  const presentation = isEnvelope ? asRecord(envelopeRecord.presentation) : {}
  const data = isEnvelope ? asRecord(envelopeRecord.data) : asRecord(edge.data)

  return {
    ...cloneSerializable(presentation),
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    ...(edge.edgeType ? { type: edge.edgeType } : {}),
    data: cloneSerializable(data),
  }
}

export function projectGraphResponseToCanvasSnapshot(graph: ProjectGraphResponse): CanvasSnapshot {
  return {
    nodes: graph.nodes.map(projectGraphNodeToCanvasNode),
    edges: graph.edges.map(projectGraphEdgeToCanvasEdge),
  }
}

export function diffCanvasSnapshots(
  baseline: CanvasSnapshot,
  current: CanvasSnapshot,
): ProjectGraphOperation[] {
  const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, canvasNodeToProjectGraphNode(node)]))
  const currentNodes = new Map(current.nodes.map((node) => [node.id, canvasNodeToProjectGraphNode(node)]))
  const baselineEdges = new Map(baseline.edges.map((edge) => [edge.id, canvasEdgeToProjectGraphEdge(edge)]))
  const currentEdges = new Map(current.edges.map((edge) => [edge.id, canvasEdgeToProjectGraphEdge(edge)]))
  const operations: ProjectGraphOperation[] = []

  for (const [nodeId, node] of currentNodes) {
    if (stableSerialize(node) !== stableSerialize(baselineNodes.get(nodeId))) {
      operations.push({ type: 'upsertNode', node })
    }
  }
  for (const nodeId of baselineNodes.keys()) {
    if (!currentNodes.has(nodeId)) {
      operations.push({ type: 'deleteNode', nodeId })
    }
  }
  for (const [edgeId, edge] of currentEdges) {
    if (stableSerialize(edge) !== stableSerialize(baselineEdges.get(edgeId))) {
      operations.push({ type: 'upsertEdge', edge })
    }
  }
  for (const edgeId of baselineEdges.keys()) {
    if (!currentEdges.has(edgeId)) {
      operations.push({ type: 'deleteEdge', edgeId })
    }
  }

  return operations
}
