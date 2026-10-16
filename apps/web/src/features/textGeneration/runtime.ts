import { create } from "zustand";
import type { TextNodeData } from "@/types";
import {
  EMPTY_TEXT_GENERATION_STATE,
  type TextGenerationState,
} from "./runner";

export interface TextNodeGenerationRuntime extends TextGenerationState {
  panelOpen?: boolean;
}

export const EMPTY_TEXT_NODE_RUNTIME: TextNodeGenerationRuntime =
  EMPTY_TEXT_GENERATION_STATE;

export function isTextGenerationPanelOpen(
  data: TextNodeData,
  runtime: TextNodeGenerationRuntime,
) {
  return runtime.panelOpen ?? (data.generationMode === "ai" && !data.text);
}

interface TextGenerationRuntimeStore {
  nodes: Record<string, TextNodeGenerationRuntime>;
  patch: (nodeId: string, patch: Partial<TextNodeGenerationRuntime>) => void;
  reset: () => void;
  retainNodes: (nodeIds: Set<string>) => void;
}

export const useTextGenerationRuntime = create<TextGenerationRuntimeStore>(
  (set) => ({
    nodes: {},
    patch: (nodeId, patch) =>
      set((state) => ({
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...(state.nodes[nodeId] ?? EMPTY_TEXT_NODE_RUNTIME),
            ...patch,
          },
        },
      })),
    reset: () => set({ nodes: {} }),
    retainNodes: (nodeIds) =>
      set((state) => {
        const entries = Object.entries(state.nodes);
        const retained = entries.filter(([id]) => nodeIds.has(id));
        return retained.length === entries.length
          ? state
          : { nodes: Object.fromEntries(retained) };
      }),
  }),
);
