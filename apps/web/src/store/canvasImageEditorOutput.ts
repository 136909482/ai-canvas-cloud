import type { Edge, Node } from "@xyflow/react";
import { getPreviewNodeSizeAtWidth } from "@/features/generateQueue/previewUtils";
import {
  buildGeneratedPreviewNode,
  type GeneratedPreviewNodeDraft,
} from "./canvasNodeCreation";
import { DEFAULT_PREVIEW_NODE_WIDTH } from "./canvasLayoutGeometry";
import { layoutGeneratedPreviewNodesInContext } from "./canvasOutputLayout";

export interface ImageEditorOutputStateInput {
  nodes: Node[];
  edges: Edge[];
  sourceNodeId: string;
  preview: GeneratedPreviewNodeDraft;
  nextPreviewId: () => string | null;
}

export interface ImageEditorOutputStateResult {
  nodes: Node[];
  edges: Edge[];
  createdNodeId: string;
}

export function buildImageEditorOutputState({
  nodes,
  edges,
  sourceNodeId,
  preview,
  nextPreviewId,
}: ImageEditorOutputStateInput): ImageEditorOutputStateResult | null {
  const sourceNode = nodes.find((node) => node.id === sourceNodeId);
  if (
    sourceNode?.type !== "imageNode" &&
    sourceNode?.type !== "generatedPreviewNode"
  ) {
    return null;
  }

  const previewId = nextPreviewId();
  if (!previewId) {
    return null;
  }

  const generatedPreview = buildGeneratedPreviewNode(
    previewId,
    sourceNodeId,
    preview,
    getPreviewNodeSizeAtWidth(
      preview.imageWidth,
      preview.imageHeight,
      DEFAULT_PREVIEW_NODE_WIDTH,
    ),
  );
  const nextNodes = layoutGeneratedPreviewNodesInContext(
    [...nodes, generatedPreview],
    sourceNodeId,
  );

  return {
    createdNodeId: previewId,
    nodes: nextNodes,
    edges: [
      ...edges,
      {
        id: `edge-${sourceNodeId}-${previewId}`,
        source: sourceNodeId,
        target: previewId,
        animated: true,
      },
    ],
  };
}
