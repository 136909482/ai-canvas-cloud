import type { InteriorDesignNodeData } from "@/types";
import {
  compileInteriorDesignPrompt,
  createDefaultInteriorDesignConfig,
  normalizeInteriorDesignConfig,
} from "./compiler";
import type { InteriorDesignConfigV1 } from "./types";

function normalizeConfig(value: unknown): InteriorDesignConfigV1 {
  try {
    return normalizeInteriorDesignConfig(value as InteriorDesignConfigV1)
      .config;
  } catch {
    return createDefaultInteriorDesignConfig();
  }
}

export function createInteriorDesignNodeData(
  value?: Record<string, unknown> | null,
): InteriorDesignNodeData {
  const config = normalizeConfig(value?.config);

  return {
    config,
    compiledPrompt: compileInteriorDesignPrompt(config),
    outputTextNodeId:
      typeof value?.outputTextNodeId === "string"
        ? value.outputTextNodeId
        : null,
  };
}
