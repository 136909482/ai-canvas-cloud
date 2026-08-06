import type { Edge, Node } from "@xyflow/react";
import { createRichPromptDocumentFromText } from "@/features/richPrompt/promptCompiler";
import {
  compileInteriorDesignPrompt,
  normalizeInteriorDesignConfig,
} from "@/features/interiorDesign/compiler";
import type { InteriorDesignConfigV1 } from "@/features/interiorDesign/types";
import type { InteriorDesignNodeData, TextNodeData } from "@/types";
import { buildManualTextNode } from "./canvasNodeCreation";
import {
  DEFAULT_INTERIOR_DESIGN_NODE_HEIGHT,
  DEFAULT_INTERIOR_DESIGN_NODE_WIDTH,
  DEFAULT_TEXT_NODE_HEIGHT,
  DEFAULT_TEXT_NODE_WIDTH,
  getAbsoluteNodePosition,
} from "./canvasLayoutGeometry";

export const INTERIOR_DESIGN_PROMPT_OUTPUT_LABEL = "室内设计 JSON 提示词";

function findLinkedOutputTextNodeId(
  nodes: Node[],
  edges: Edge[],
  sourceNode: Node<InteriorDesignNodeData>,
) {
  const storedOutputNodeId = sourceNode.data.outputTextNodeId;
  const linkedEdge = edges.find(
    (edge) =>
      edge.source === sourceNode.id &&
      edge.sourceHandle === "prompt" &&
      (!storedOutputNodeId || edge.target === storedOutputNodeId) &&
      nodes.some((node) => node.id === edge.target && node.type === "textNode"),
  );

  return linkedEdge?.target ?? null;
}

function updatePromptTextNode(node: Node, compiledPrompt: string): Node {
  return {
    ...node,
    data: {
      ...node.data,
      text: compiledPrompt,
      richPrompt: createRichPromptDocumentFromText(compiledPrompt),
    },
  };
}

export function buildInteriorDesignConfigUpdatedState({
  nodes,
  edges,
  sourceNodeId,
  config,
}: {
  nodes: Node[];
  edges: Edge[];
  sourceNodeId: string;
  config: InteriorDesignConfigV1;
}) {
  const sourceNode = nodes.find(
    (node): node is Node<InteriorDesignNodeData> =>
      node.id === sourceNodeId && node.type === "interiorDesignNode",
  );
  if (!sourceNode) return { nodes, compiledPrompt: "" };

  const normalizedConfig = normalizeInteriorDesignConfig(config).config;
  const compiledPrompt = compileInteriorDesignPrompt(normalizedConfig);
  const outputTextNodeId = findLinkedOutputTextNodeId(nodes, edges, sourceNode);

  return {
    nodes: nodes.map((node) => {
      if (node.id === sourceNodeId) {
        return {
          ...node,
          data: {
            config: normalizedConfig,
            compiledPrompt,
            outputTextNodeId,
          } satisfies InteriorDesignNodeData,
        };
      }

      return node.id === outputTextNodeId
        ? updatePromptTextNode(node, compiledPrompt)
        : node;
    }),
    compiledPrompt,
  };
}

export function buildInteriorDesignPromptOutputState({
  nodes,
  edges,
  sourceNodeId,
  nextTextNodeId,
}: {
  nodes: Node[];
  edges: Edge[];
  sourceNodeId: string;
  nextTextNodeId: () => string | null;
}) {
  const sourceNode = nodes.find(
    (node): node is Node<InteriorDesignNodeData> =>
      node.id === sourceNodeId && node.type === "interiorDesignNode",
  );
  if (!sourceNode) return null;

  const normalizedConfig = normalizeInteriorDesignConfig(
    sourceNode.data.config,
  ).config;
  const compiledPrompt = compileInteriorDesignPrompt(normalizedConfig);
  const linkedOutputTextNodeId = findLinkedOutputTextNodeId(
    nodes,
    edges,
    sourceNode,
  );
  const outputTextNodeId = linkedOutputTextNodeId ?? nextTextNodeId();
  if (!outputTextNodeId) return null;

  const outputExists = nodes.some(
    (node) => node.id === outputTextNodeId && node.type === "textNode",
  );
  let nextNodes = nodes.map((node) => {
    if (node.id === sourceNodeId) {
      return {
        ...node,
        selected: false,
        data: {
          config: normalizedConfig,
          compiledPrompt,
          outputTextNodeId,
        } satisfies InteriorDesignNodeData,
      };
    }

    if (node.id === outputTextNodeId) {
      return {
        ...updatePromptTextNode(node, compiledPrompt),
        selected: true,
      };
    }

    return node.selected ? { ...node, selected: false } : node;
  });

  if (!outputExists) {
    const absoluteSourcePosition = getAbsoluteNodePosition(nodes, sourceNode);
    const sourceWidth =
      typeof sourceNode.width === "number"
        ? sourceNode.width
        : DEFAULT_INTERIOR_DESIGN_NODE_WIDTH;
    const sourceHeight =
      typeof sourceNode.height === "number"
        ? sourceNode.height
        : DEFAULT_INTERIOR_DESIGN_NODE_HEIGHT;
    const outputNode = buildManualTextNode(
      outputTextNodeId,
      {
        x: absoluteSourcePosition.x + sourceWidth + 72,
        y:
          absoluteSourcePosition.y +
          Math.max((sourceHeight - DEFAULT_TEXT_NODE_HEIGHT) / 2, 0),
      },
      {
        width: DEFAULT_TEXT_NODE_WIDTH,
        height: DEFAULT_TEXT_NODE_HEIGHT,
      },
    );
    outputNode.data = {
      text: compiledPrompt,
      richPrompt: createRichPromptDocumentFromText(compiledPrompt),
      label: INTERIOR_DESIGN_PROMPT_OUTPUT_LABEL,
    } satisfies TextNodeData;
    outputNode.selected = true;
    nextNodes = [...nextNodes, outputNode];
  }

  const hasOutputEdge = edges.some(
    (edge) =>
      edge.source === sourceNodeId &&
      edge.sourceHandle === "prompt" &&
      edge.target === outputTextNodeId &&
      edge.targetHandle === "input",
  );

  return {
    nodes: nextNodes,
    edges: hasOutputEdge
      ? edges
      : [
          ...edges,
          {
            id: `edge-${sourceNodeId}-${outputTextNodeId}`,
            source: sourceNodeId,
            sourceHandle: "prompt",
            target: outputTextNodeId,
            targetHandle: "input",
            animated: true,
          },
        ],
    outputTextNodeId,
  };
}
