import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { fetchCreditBalance } from "./api";
import { useSettingsDialogStore } from "@/store/useSettingsDialogStore";

export function CreditBalanceButton() {
  const [balance, setBalance] = useState<number | null>(null);
  const open = useSettingsDialogStore((state) => state.open);
  useEffect(() => {
    void fetchCreditBalance()
      .then((value) => setBalance(value.available))
      .catch(() => undefined);
  }, []);
  return (
    <button
      type="button"
      onClick={() => open("credits")}
      title="使用中心"
      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-xs font-semibold text-amber-500 transition hover:bg-amber-400/10 dark:text-amber-300"
    >
      <Coins className="h-3.5 w-3.5" />
      <span>{balance ?? "--"}</span>
    </button>
  );
}
