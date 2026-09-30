import { useSyncExternalStore } from "react";
import type { CreditBalance } from "@ai-canvas-cloud/contracts";

let balance: CreditBalance | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCreditBalanceRuntime() {
  return balance;
}

export function setCreditBalanceRuntime(nextBalance: CreditBalance) {
  if (
    balance &&
    Date.parse(nextBalance.updatedAt) < Date.parse(balance.updatedAt)
  ) {
    return;
  }
  if (
    balance?.available === nextBalance.available &&
    balance.reserved === nextBalance.reserved &&
    balance.updatedAt === nextBalance.updatedAt
  ) {
    return;
  }
  balance = nextBalance;
  for (const listener of listeners) listener();
}

export function resetCreditBalanceRuntime() {
  if (balance === null) return;
  balance = null;
  for (const listener of listeners) listener();
}

export function useCreditBalanceRuntime() {
  return useSyncExternalStore(
    subscribe,
    getCreditBalanceRuntime,
    getCreditBalanceRuntime,
  );
}
