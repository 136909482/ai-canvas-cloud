type SelectableNode = {
  id: string;
  selected?: boolean;
};

type DirectedEdge = {
  source: string;
  target: string;
};

export function getSingleSelectedNodeId(
  nodes: ReadonlyArray<SelectableNode>,
): string | null {
  let selectedNodeId: string | null = null;

  for (const node of nodes) {
    if (!node.selected) continue;
    if (selectedNodeId !== null) return null;
    selectedNodeId = node.id;
  }

  return selectedNodeId;
}

export function shouldAnimateConnectedEdge(
  edge: DirectedEdge,
  selectedNodeId: string | null,
  enabled: boolean,
) {
  return (
    enabled &&
    selectedNodeId !== null &&
    (edge.source === selectedNodeId || edge.target === selectedNodeId)
  );
}
