export type ModelSelectionRef =
  | { source: "official"; modelId: string }
  | { source: "custom"; modelEntryId: string };

const OFFICIAL_PREFIX = "official:";

export function serializeModelSelectionRef(reference: ModelSelectionRef) {
  return reference.source === "official"
    ? `${OFFICIAL_PREFIX}${reference.modelId}`
    : reference.modelEntryId;
}

export function parseModelSelectionRef(value: string): ModelSelectionRef {
  const normalized = value.trim();
  return normalized.startsWith(OFFICIAL_PREFIX)
    ? { source: "official", modelId: normalized.slice(OFFICIAL_PREFIX.length) }
    : { source: "custom", modelEntryId: normalized };
}

export function isOfficialModelReference(value: string) {
  return parseModelSelectionRef(value).source === "official";
}
