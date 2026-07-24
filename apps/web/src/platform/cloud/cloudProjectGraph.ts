import type { Edge, Node } from "@xyflow/react";
import type {
  ProjectGraphChange,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphOperation,
  ProjectGraphResponse,
} from "@ai-canvas-cloud/contracts";
import type { CanvasSnapshot } from "@/types";

const EDGE_ENVELOPE_KEY = "__aiCanvasCloudEdge";
export const PROJECT_GRAPH_OPERATION_BATCH_SIZE = 500;

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function stableSerialize(value: unknown) {
  return JSON.stringify(stableValue(value));
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
  } = node;
  const hasSize =
    typeof width === "number" &&
    width > 0 &&
    typeof height === "number" &&
    height > 0;

  return cloneSerializable({
    id,
    nodeType: type ?? "default",
    position,
    ...(hasSize ? { size: { width, height } } : {}),
    ...(typeof zIndex === "number" ? { zIndex } : {}),
    parentNodeId: parentId ?? null,
    dataSchemaVersion: 1,
    data: asRecord(data),
    presentation,
  });
}

export function projectGraphNodeToCanvasNode(node: ProjectGraphNode): Node {
  return {
    ...cloneSerializable(node.presentation ?? {}),
    id: node.id,
    type: node.nodeType,
    position: cloneSerializable(node.position),
    data: cloneSerializable(node.data),
    ...(node.size ? { width: node.size.width, height: node.size.height } : {}),
    ...(typeof node.zIndex === "number" ? { zIndex: node.zIndex } : {}),
    ...(node.parentNodeId ? { parentId: node.parentNodeId } : {}),
  } as Node;
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
  } = edge;

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
  });
}

export function projectGraphEdgeToCanvasEdge(edge: ProjectGraphEdge): Edge {
  const envelope = asRecord(edge.data)[EDGE_ENVELOPE_KEY];
  const envelopeRecord = asRecord(envelope);
  const isEnvelope = envelopeRecord.schemaVersion === 1;
  const presentation = isEnvelope ? asRecord(envelopeRecord.presentation) : {};
  const data = isEnvelope ? asRecord(envelopeRecord.data) : asRecord(edge.data);

  return {
    ...cloneSerializable(presentation),
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    ...(edge.edgeType ? { type: edge.edgeType } : {}),
    data: cloneSerializable(data),
  };
}

export function projectGraphResponseToCanvasSnapshot(
  graph: ProjectGraphResponse,
): CanvasSnapshot {
  return {
    nodes: graph.nodes.map(projectGraphNodeToCanvasNode),
    edges: graph.edges.map(projectGraphEdgeToCanvasEdge),
  };
}

export function diffCanvasSnapshots(
  baseline: CanvasSnapshot,
  current: CanvasSnapshot,
): ProjectGraphOperation[] {
  const baselineNodes = new Map(
    baseline.nodes.map((node) => [node.id, canvasNodeToProjectGraphNode(node)]),
  );
  const currentNodes = new Map(
    current.nodes.map((node) => [node.id, canvasNodeToProjectGraphNode(node)]),
  );
  const baselineEdges = new Map(
    baseline.edges.map((edge) => [edge.id, canvasEdgeToProjectGraphEdge(edge)]),
  );
  const currentEdges = new Map(
    current.edges.map((edge) => [edge.id, canvasEdgeToProjectGraphEdge(edge)]),
  );
  const operations: ProjectGraphOperation[] = [];

  for (const [nodeId, node] of currentNodes) {
    if (stableSerialize(node) !== stableSerialize(baselineNodes.get(nodeId))) {
      operations.push({ type: "upsertNode", node });
    }
  }
  for (const nodeId of baselineNodes.keys()) {
    if (!currentNodes.has(nodeId)) {
      operations.push({ type: "deleteNode", nodeId });
    }
  }
  for (const [edgeId, edge] of currentEdges) {
    if (stableSerialize(edge) !== stableSerialize(baselineEdges.get(edgeId))) {
      operations.push({ type: "upsertEdge", edge });
    }
  }
  for (const edgeId of baselineEdges.keys()) {
    if (!currentEdges.has(edgeId)) {
      operations.push({ type: "deleteEdge", edgeId });
    }
  }

  return operations;
}

function sortUpsertNodeOperations(operations: ProjectGraphOperation[]) {
  const upserts = operations.filter(
    (operation) => operation.type === "upsertNode",
  );
  const byNodeId = new Map(
    upserts.map((operation) => [operation.node.id, operation]),
  );
  const originalOrder = new Map(
    upserts.map((operation, index) => [operation.node.id, index]),
  );
  const sorted: ProjectGraphOperation[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (
    operation: Extract<ProjectGraphOperation, { type: "upsertNode" }>,
  ) => {
    if (visited.has(operation.node.id)) {
      return;
    }
    if (visiting.has(operation.node.id)) {
      sorted.push(operation);
      visited.add(operation.node.id);
      return;
    }

    visiting.add(operation.node.id);
    const parentId = operation.node.parentNodeId;
    const parentOperation = parentId ? byNodeId.get(parentId) : undefined;
    if (parentOperation) {
      visit(parentOperation);
    }
    visiting.delete(operation.node.id);

    if (!visited.has(operation.node.id)) {
      sorted.push(operation);
      visited.add(operation.node.id);
    }
  };

  for (const operation of [...upserts].sort(
    (left, right) =>
      (originalOrder.get(left.node.id) ?? 0) -
      (originalOrder.get(right.node.id) ?? 0),
  )) {
    visit(operation);
  }

  return sorted;
}

function getBaselineNodeDepths(baseline: CanvasSnapshot) {
  const parents = new Map(
    baseline.nodes.map((node) => [
      node.id,
      canvasNodeToProjectGraphNode(node).parentNodeId ?? null,
    ]),
  );
  const depths = new Map<string, number>();

  const depthOf = (nodeId: string): number => {
    const cached = depths.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }

    const parentId = parents.get(nodeId);
    const depth = parentId && parents.has(parentId) ? depthOf(parentId) + 1 : 0;
    depths.set(nodeId, depth);
    return depth;
  };

  for (const nodeId of parents.keys()) {
    depthOf(nodeId);
  }

  return depths;
}

export function buildProjectGraphOperationBatches(
  baseline: CanvasSnapshot,
  operations: ProjectGraphOperation[],
  maxBatchSize = PROJECT_GRAPH_OPERATION_BATCH_SIZE,
) {
  if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("maxBatchSize must be a positive safe integer");
  }

  const baselineDepths = getBaselineNodeDepths(baseline);
  const deleteNodeOperations = operations
    .filter((operation) => operation.type === "deleteNode")
    .sort(
      (left, right) =>
        (baselineDepths.get(right.nodeId) ?? 0) -
        (baselineDepths.get(left.nodeId) ?? 0),
    );
  const orderedOperations = [
    ...operations.filter((operation) => operation.type === "deleteEdge"),
    ...deleteNodeOperations,
    ...sortUpsertNodeOperations(operations),
    ...operations.filter((operation) => operation.type === "upsertEdge"),
  ];
  const batches: ProjectGraphOperation[][] = [];

  for (let index = 0; index < orderedOperations.length; index += maxBatchSize) {
    batches.push(orderedOperations.slice(index, index + maxBatchSize));
  }

  return batches;
}

export function applyProjectGraphOperationBatch(
  baseline: CanvasSnapshot,
  operations: ProjectGraphOperation[],
): CanvasSnapshot {
  const nodes = new Map(
    baseline.nodes.map((node) => [node.id, canvasNodeToProjectGraphNode(node)]),
  );
  const edges = new Map(
    baseline.edges.map((edge) => [edge.id, canvasEdgeToProjectGraphEdge(edge)]),
  );

  for (const operation of operations) {
    if (operation.type === "upsertNode") {
      nodes.set(operation.node.id, cloneSerializable(operation.node));
    } else if (operation.type === "deleteNode") {
      nodes.delete(operation.nodeId);
      for (const [edgeId, edge] of edges) {
        if (
          edge.source === operation.nodeId ||
          edge.target === operation.nodeId
        ) {
          edges.delete(edgeId);
        }
      }
    } else if (operation.type === "upsertEdge") {
      edges.set(operation.edge.id, cloneSerializable(operation.edge));
    } else if (operation.type === "deleteEdge") {
      edges.delete(operation.edgeId);
    }
  }

  return {
    nodes: [...nodes.values()].map(projectGraphNodeToCanvasNode),
    edges: [...edges.values()].map(projectGraphEdgeToCanvasEdge),
  };
}

interface ProjectGraphOperationTouchSet {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

function collectProjectGraphOperationTouches(
  operations: ProjectGraphOperation[],
): ProjectGraphOperationTouchSet {
  const touches: ProjectGraphOperationTouchSet = {
    nodeIds: new Set<string>(),
    edgeIds: new Set<string>(),
  };

  for (const operation of operations) {
    if (operation.type === "upsertNode") {
      touches.nodeIds.add(operation.node.id);
      if (operation.node.parentNodeId) {
        touches.nodeIds.add(operation.node.parentNodeId);
      }
    } else if (operation.type === "deleteNode") {
      touches.nodeIds.add(operation.nodeId);
    } else if (operation.type === "upsertEdge") {
      touches.edgeIds.add(operation.edge.id);
      touches.nodeIds.add(operation.edge.source);
      touches.nodeIds.add(operation.edge.target);
    } else if (operation.type === "deleteEdge") {
      touches.edgeIds.add(operation.edgeId);
    }
  }

  return touches;
}

function touchesOverlap(
  left: ProjectGraphOperationTouchSet,
  right: ProjectGraphOperationTouchSet,
) {
  for (const nodeId of left.nodeIds) {
    if (right.nodeIds.has(nodeId)) {
      return true;
    }
  }
  for (const edgeId of left.edgeIds) {
    if (right.edgeIds.has(edgeId)) {
      return true;
    }
  }

  return false;
}

export function doProjectGraphOperationsOverlap(
  left: ProjectGraphOperation[],
  right: ProjectGraphOperation[],
) {
  return touchesOverlap(
    collectProjectGraphOperationTouches(left),
    collectProjectGraphOperationTouches(right),
  );
}

export function doProjectGraphChangesOverlap(
  localOperations: ProjectGraphOperation[],
  remoteChanges: ProjectGraphChange[],
) {
  return doProjectGraphOperationsOverlap(
    localOperations,
    remoteChanges.flatMap((change) => change.operations),
  );
}

export function applyProjectGraphChanges(
  baseline: CanvasSnapshot,
  changes: ProjectGraphChange[],
) {
  return changes.reduce(
    (current, change) =>
      applyProjectGraphOperationBatch(current, change.operations),
    baseline,
  );
}
