import type { Edge, Node } from "@xyflow/react";
import type { ImportedImageResult } from "@/features/imageImport/runtime";
import { createImageNodeData } from "@/store/canvasNodeData";
import { buildSyncedGraphState } from "@/store/canvasConnectionDerivedData";
import { getWorkspaceAssetRelativePath } from "@/utils/workspaceImageAsset";
import { normalizeGenerateOutputCount } from "@/constants/generateNode";

export function getGeneratedImageCardSize(
  imageWidth: number,
  imageHeight: number,
  nodeWidth = 360,
) {
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  )
    return null;

  // The image card has a one-pixel shell border and no content padding.
  const border = 2;
  const maxContentSize = 900 - border;
  const width = Number.isFinite(nodeWidth) ? nodeWidth : 360;
  let contentWidth = Math.min(900, Math.max(100, width)) - border;
  let contentHeight = (contentWidth * imageHeight) / imageWidth;
  if (contentHeight > maxContentSize) {
    contentHeight = maxContentSize;
    contentWidth = (contentHeight * imageWidth) / imageHeight;
  }
  return {
    width: Math.max(border + 1, Math.round(contentWidth + border)),
    height: Math.max(border + 1, Math.round(contentHeight + border)),
  };
}

// Uploads become ordinary source images; generation keeps using its existing node type.
export function buildUploadedImageGraph(
  nodes: Node[],
  edges: Edge[],
  id: string,
  image: ImportedImageResult,
) {
  const node = nodes.find((candidate) => candidate.id === id);
  if (
    !node ||
    node.type !== "generateNode" ||
    node.data.imageUrl ||
    node.data.status === "queued" ||
    node.data.status === "generating"
  )
    return null;
  const nextNodes = nodes.map((candidate) =>
    candidate.id === id
      ? {
          ...candidate,
          type: "imageNode",
          width: image.width,
          height: image.height,
          measured: undefined,
          data: createImageNodeData({
            imageUrl: image.imageUrl,
            imageAsset: image.imageAsset,
            name: image.name,
            imageNaturalWidth: image.naturalWidth,
            imageNaturalHeight: image.naturalHeight,
          }),
        }
      : candidate,
  );
  const nextEdges = edges
    .filter((edge) => edge.target !== id)
    .map((edge) =>
      edge.source === id ? { ...edge, sourceHandle: "output" } : edge,
    );
  return buildSyncedGraphState(nextNodes, nextEdges);
}

// Queue result nodes retain independent task/asset state. Single-image submissions
// display only on the source card; batches keep their distinct images on canvas.
export function getInlineImageResultIds(nodes: Node[], edges: Edge[]) {
  const sources = new Map(
    nodes
      .filter((node) => node.type === "generateNode")
      .map((node) => [node.id, node]),
  );
  const usedSources = new Set(edges.map((edge) => edge.source));
  return new Set(
    nodes
      .filter((node) => {
        if (
          node.type !== "generatedPreviewNode" ||
          usedSources.has(node.id) ||
          node.parentId
        )
          return false;
        const source = sources.get(String(node.data.sourceGenerateNodeId));
        if (!source) return false;
        // Older projects lack per-result presentation metadata. Default those to
        // the source's saved output count, without hiding explicitly batched images.
        if (
          node.data.resultDisplay === "inline" ||
          (node.data.resultDisplay !== "canvas" &&
            normalizeGenerateOutputCount(source.data.outputCount) === 1)
        )
          return true;
        if (node.selected) return false;
        // Batch results keep distinct images. Their current mirrored image and
        // empty automatic task placeholders are redundant with the source card.
        if (!node.data.imageUrl)
          return (
            node.data.layoutMode === "auto" &&
            (node.data.status === "queued" ||
              node.data.status === "generating" ||
              node.data.status === "error")
          );
        const assetPath = getWorkspaceAssetRelativePath(node.data.imageAsset);
        return Boolean(
          source.data.imageUrl &&
          (source.data.imageUrl === node.data.imageUrl ||
            (assetPath &&
              assetPath ===
                getWorkspaceAssetRelativePath(source.data.imageAsset))),
        );
      })
      .map((node) => node.id),
  );
}
