import type { Edge, Node } from "@xyflow/react";
import type { AppNode } from "@/types";
import {
  getGenerateMaskSourceNode,
  getGenerateReferenceSourceNodes,
  getImageEditReferenceSourceNodes,
  getLLMInputImageSourceNodes,
} from "./canvasConnectionSources";

export const selectSelectedTopLevelNodes = ({ nodes }: { nodes: Node[] }) =>
  nodes.filter((node) => node.selected && node.type !== "groupNode");

export const selectSelectedGroupNodes = ({ nodes }: { nodes: Node[] }) =>
  nodes.filter((node) => node.selected && node.type === "groupNode");

export function selectSingleSelectedGenerateNode({
  nodes,
}: {
  nodes: Node[];
}): AppNode<"generateNode"> | null {
  let selected: Node | null = null;
  for (const node of nodes) {
    if (!node.selected) continue;
    if (selected) return null;
    selected = node;
  }
  return selected?.type === "generateNode"
    ? (selected as AppNode<"generateNode">)
    : null;
}

export function selectSingleSelectedTextNode({
  nodes,
}: {
  nodes: Node[];
}): AppNode<"textNode"> | null {
  let selected: Node | null = null;
  for (const node of nodes) {
    if (!node.selected) continue;
    if (selected) return null;
    selected = node;
  }
  return selected?.type === "textNode"
    ? (selected as AppNode<"textNode">)
    : null;
}

export const selectHasCanvasContent = ({
  nodes,
  edges,
}: {
  nodes: Node[];
  edges: Edge[];
}) => nodes.length > 0 || edges.length > 0;

export const makeSelectGenerateReferenceSourceNodes =
  (nodeId: string) =>
  ({ nodes }: { nodes: Node[] }) =>
    getGenerateReferenceSourceNodes(nodes, nodeId);

export const makeSelectGenerateMaskSourceNode =
  (nodeId: string) =>
  ({ nodes }: { nodes: Node[] }) =>
    getGenerateMaskSourceNode(nodes, nodeId);

export const makeSelectImageEditReferenceSourceNodes =
  (nodeId: string) =>
  ({ nodes }: { nodes: Node[] }) =>
    getImageEditReferenceSourceNodes(nodes, nodeId);

export const makeSelectLLMInputImageSourceNodes =
  (nodeId: string) =>
  ({ nodes }: { nodes: Node[] }) =>
    getLLMInputImageSourceNodes(nodes, nodeId);
