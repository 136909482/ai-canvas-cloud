import type { CreditLedgerEntry } from "@ai-canvas-cloud/contracts";

const HIDDEN_GENERATION_ENTRY_TYPES = new Set<CreditLedgerEntry["type"]>([
  "generation_reserve",
  "generation_release",
]);

export function getVisibleCreditLedgerEntries<
  T extends Pick<CreditLedgerEntry, "type">,
>(entries: readonly T[]) {
  return entries.filter(
    (entry) => !HIDDEN_GENERATION_ENTRY_TYPES.has(entry.type),
  );
}
