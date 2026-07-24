import type { CanvasSnapshot } from "@/types";

export function hasGraphDeletion(
  current: CanvasSnapshot,
  previous: CanvasSnapshot,
) {
  if (
    current.nodes.length < previous.nodes.length ||
    current.edges.length < previous.edges.length
  ) {
    return true;
  }

  const currentNodeIds = new Set(current.nodes.map((node) => node.id));
  if (previous.nodes.some((node) => !currentNodeIds.has(node.id))) {
    return true;
  }

  const currentEdgeIds = new Set(current.edges.map((edge) => edge.id));
  return previous.edges.some((edge) => !currentEdgeIds.has(edge.id));
}
