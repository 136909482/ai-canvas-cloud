import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleCreditLedgerEntries } from "./creditLedger.ts";

test("credit history hides temporary official generation reservations", () => {
  const entries = [
    { type: "generation_reserve" as const },
    { type: "generation_capture" as const },
    { type: "generation_release" as const },
    { type: "admin_adjustment" as const },
  ];

  assert.deepEqual(
    getVisibleCreditLedgerEntries(entries).map((entry) => entry.type),
    ["generation_capture", "admin_adjustment"],
  );
});
