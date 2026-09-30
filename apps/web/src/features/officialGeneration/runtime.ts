import { useSyncExternalStore } from "react";
import type {
  OfficialGenerationPreferences,
  OfficialModelSummary,
  OfficialModelsResponse,
} from "@ai-canvas-cloud/contracts";

export type OfficialGenerationRuntime = {
  preferences: OfficialGenerationPreferences | null;
  models: OfficialModelSummary[];
};

const EMPTY_RUNTIME: OfficialGenerationRuntime = {
  preferences: null,
  models: [],
};

let runtime = EMPTY_RUNTIME;
const listeners = new Set<() => void>();
let runtimeRevision = 0;

function emit() {
  for (const listener of listeners) listener();
}

export function getOfficialGenerationRuntime() {
  return runtime;
}

export function setOfficialGenerationRuntime(response: OfficialModelsResponse) {
  runtime = {
    preferences: response.preferences,
    models: response.preferences.effectiveEnabled
      ? response.models
      : runtime.models,
  };
  emit();
}

export function getOfficialGenerationRevision() {
  return runtimeRevision;
}

export function setOfficialGenerationPreferences(
  preferences: OfficialGenerationPreferences,
) {
  runtime = {
    preferences,
    models: runtime.models,
  };
  runtimeRevision += 1;
  emit();
}

export function useOfficialGenerationRuntime() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getOfficialGenerationRuntime,
    getOfficialGenerationRuntime,
  );
}
