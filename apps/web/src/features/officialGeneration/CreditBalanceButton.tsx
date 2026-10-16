import { useEffect } from "react";
import { Zap } from "lucide-react";
import { fetchCreditBalance } from "./api";
import { useCreditBalanceRuntime } from "./creditRuntime";
import { useSettingsDialogStore } from "@/store/useSettingsDialogStore";

export function CreditBalanceButton() {
  const balance = useCreditBalanceRuntime();
  const open = useSettingsDialogStore((state) => state.open);
  useEffect(() => {
    void fetchCreditBalance().catch(() => undefined);
  }, []);
  return (
    <button
      type="button"
      onClick={() => open("credits")}
      title="算力余额 · 使用中心"
      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)]"
    >
      <Zap aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
      <span>{balance?.available ?? "--"}</span>
    </button>
  );
}
