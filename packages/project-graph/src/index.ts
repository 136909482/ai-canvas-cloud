import type {
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphOperation,
} from '@ai-canvas-cloud/contracts'

export type {
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphOperation,
} from '@ai-canvas-cloud/contracts'

export interface ProjectGraphSnapshot {
  version: number
  sequence: number
  nodes: ProjectGraphNode[]
  edges: ProjectGraphEdge[]
}

export function createEmptyProjectGraph(): ProjectGraphSnapshot {
  return {
    version: 0,
    sequence: 0,
    nodes: [],
    edges: [],
  }
}

export function applyProjectGraphOperations(
  snapshot: ProjectGraphSnapshot,
  operations: ProjectGraphOperation[],
): ProjectGraphSnapshot {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const edgesById = new Map(snapshot.edges.map((edge) => [edge.id, edge]))

  for (const operation of operations) {
    if (operation.type === 'upsertNode') {
      nodesById.set(operation.node.id, operation.node)
      continue
    }

    if (operation.type === 'deleteNode') {
      nodesById.delete(operation.nodeId)
      for (const [edgeId, edge] of edgesById) {
        if (edge.source === operation.nodeId || edge.target === operation.nodeId) {
          edgesById.delete(edgeId)
        }
      }
      continue
    }

    if (operation.type === 'upsertEdge') {
      if (!nodesById.has(operation.edge.source) || !nodesById.has(operation.edge.target)) {
        throw new Error(`Edge ${operation.edge.id} references missing nodes`)
      }

      edgesById.set(operation.edge.id, operation.edge)
      continue
    }

    edgesById.delete(operation.edgeId)
  }

  return {
    version: snapshot.version + 1,
    sequence: snapshot.sequence + 1,
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()],
  }
}
