import type { OfficialModelSummary } from "@ai-canvas-cloud/contracts";
import { parseModelSelectionRef } from "./modelReference";
import { normalizeGenerateOutputCount } from "@/constants/generateNode";

export function getOfficialModelCreditCost(
  reference: string,
  resolution: string,
  models: OfficialModelSummary[],
  outputCount = 1,
) {
  const selection = parseModelSelectionRef(reference);
  if (selection.source !== "official") return null;
  const model = models.find((candidate) => candidate.id === selection.modelId);
  if (!model || !(resolution in model.prices)) return null;
  const price = model.prices[resolution as keyof typeof model.prices];
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price * normalizeGenerateOutputCount(outputCount)
    : null;
}
