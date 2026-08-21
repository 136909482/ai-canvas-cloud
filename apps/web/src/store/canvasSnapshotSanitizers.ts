import type { Edge, Node } from "@xyflow/react";
import type { CanvasSnapshot } from "@/types";
import { createInteriorDesignNodeData } from "@/features/interiorDesign/nodeData";
import { createEntourageNodeData } from "./canvasNodeData";
import { createInteriorRefurnishNodeData } from "@/features/interiorRefurnish/runtime";
import {
  DEFAULT_INTERIOR_REFURNISH_NODE_HEIGHT,
  DEFAULT_INTERIOR_REFURNISH_NODE_WIDTH,
} from "./canvasLayoutGeometry";

type NormalizeNodes = (nodes: Node[]) => Node[];

const LEGACY_INTERIOR_REFURNISH_NODE_HEIGHTS = new Set([480, 560]);

function sanitizeNodeWithImageAsset(
  node: Node,
  emptyImageUrl: string | null,
): Node {
  return {
    ...node,
    selected: false,
    data: {
      ...node.data,
      imageUrl: node.data?.imageAsset
        ? emptyImageUrl
        : typeof node.data?.imageUrl === "string"
          ? node.data.imageUrl
          : emptyImageUrl,
    },
  };
}

function sanitizeNodeWithVideoAsset(node: Node): Node {
  return {
    ...node,
    selected: false,
    data: {
      ...node.data,
      videoUrl: node.data?.videoAsset
        ? null
        : typeof node.data?.videoUrl === "string"
          ? node.data.videoUrl
          : null,
    },
  };
}

export function sanitizeNodeForPersistence(node: Node): Node {
  if (node.type === "videoNode") {
    return sanitizeNodeWithVideoAsset(node);
  }

  if (
    node.type === "imageNode" ||
    node.type === "generateNode" ||
    node.type === "testImageNode"
  ) {
    return sanitizeNodeWithImageAsset(node, null);
  }

  if (node.type === "generatedPreviewNode") {
    return sanitizeNodeWithImageAsset(node, "");
  }

  if (node.type === "interiorDesignNode") {
    return {
      ...node,
      selected: false,
      data: createInteriorDesignNodeData(node.data),
    };
  }

  if (node.type === "entourageNode") {
    return {
      ...node,
      selected: false,
      data: createEntourageNodeData(node.data),
    };
  }

  if (node.type === "interiorRefurnishNode") {
    return {
      ...node,
      height:
        node.width === DEFAULT_INTERIOR_REFURNISH_NODE_WIDTH &&
        typeof node.height === "number" &&
        LEGACY_INTERIOR_REFURNISH_NODE_HEIGHTS.has(node.height)
          ? DEFAULT_INTERIOR_REFURNISH_NODE_HEIGHT
          : node.height,
      selected: false,
      data: createInteriorRefurnishNodeData({
        ...node.data,
        imageUrl: node.data?.imageAsset ? null : node.data?.imageUrl,
        recognitionStatus:
          node.data?.recognitionStatus === "recognizing"
            ? "idle"
            : node.data?.recognitionStatus,
        recognitionError:
          node.data?.recognitionStatus === "recognizing"
            ? ""
            : node.data?.recognitionError,
      }),
    };
  }

  return {
    ...node,
    selected: false,
  };
}

export function sanitizeNodeForHistory(node: Node): Node {
  if (node.type === "interiorRefurnishNode") {
    return {
      ...node,
      height:
        node.width === DEFAULT_INTERIOR_REFURNISH_NODE_WIDTH &&
        typeof node.height === "number" &&
        LEGACY_INTERIOR_REFURNISH_NODE_HEIGHTS.has(node.height)
          ? DEFAULT_INTERIOR_REFURNISH_NODE_HEIGHT
          : node.height,
      selected: false,
    };
  }

  return {
    ...node,
    selected: false,
  };
}

export function sanitizeEdge(edge: Edge): Edge {
  const nextEdge = { ...edge };
  delete nextEdge.type;

  return {
    ...nextEdge,
    animated: true,
    selected: false,
  };
}

function normalizeInteriorDesignGraph(
  snapshot: CanvasSnapshot,
): CanvasSnapshot {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const interiorNodeIds = new Set(
    snapshot.nodes
      .filter((node) => node.type === "interiorDesignNode")
      .map((node) => node.id),
  );
  const edges = snapshot.edges.filter((edge) => {
    if (interiorNodeIds.has(edge.target)) return false;
    return !(
      interiorNodeIds.has(edge.source) &&
      nodeById.get(edge.target)?.type === "generatedPreviewNode"
    );
  });
  const linkedOutputByInteriorId = new Map(
    edges
      .filter(
        (edge) =>
          interiorNodeIds.has(edge.source) &&
          edge.sourceHandle === "prompt" &&
          nodeById.get(edge.target)?.type === "textNode",
      )
      .map((edge) => [edge.source, edge.target]),
  );

  return {
    nodes: snapshot.nodes.map((node) =>
      node.type === "interiorDesignNode"
        ? {
            ...node,
            data: {
              ...createInteriorDesignNodeData(node.data),
              outputTextNodeId: linkedOutputByInteriorId.get(node.id) ?? null,
            },
          }
        : node,
    ),
    edges,
  };
}

export function sanitizeCanvasSnapshotForPersistence(
  snapshot: CanvasSnapshot,
  normalizeNodes: NormalizeNodes,
): CanvasSnapshot {
  const normalizedSnapshot = normalizeInteriorDesignGraph({
    nodes: normalizeNodes(snapshot.nodes ?? []),
    edges: snapshot.edges ?? [],
  });
  return {
    nodes: normalizedSnapshot.nodes.map((node) =>
      sanitizeNodeForPersistence(node),
    ),
    edges: normalizedSnapshot.edges.map((edge) => sanitizeEdge(edge)),
  };
}

export function sanitizeCanvasSnapshotForHistory(
  snapshot: CanvasSnapshot,
  normalizeNodes: NormalizeNodes,
): CanvasSnapshot {
  const normalizedSnapshot = normalizeInteriorDesignGraph({
    nodes: normalizeNodes(snapshot.nodes ?? []),
    edges: snapshot.edges ?? [],
  });
  return {
    nodes: normalizedSnapshot.nodes.map((node) => sanitizeNodeForHistory(node)),
    edges: normalizedSnapshot.edges.map((edge) => sanitizeEdge(edge)),
  };
}
