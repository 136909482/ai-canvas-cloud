import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CircleDollarSign,
  Coins,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  CreditBalance,
  CreditLedgerEntry,
  OfficialGenerationPreferences,
} from "@ai-canvas-cloud/contracts";
import { CloudApiError } from "@/api/cloudApiClient";
import { CanvasSettingsSwitch } from "@/components/toolbar/settingsComponents";
import { themeClasses } from "@/styles/themeClasses";
import {
  fetchCreditBalance,
  fetchCreditLedger,
  fetchOfficialGenerationPreferences,
  redeemCreditCode,
  updateOfficialGenerationPreferences,
} from "./api";

const ENTRY_LABELS: Record<CreditLedgerEntry["type"], string> = {
  signup_bonus: "注册赠送",
  redemption: "兑换码",
  admin_adjustment: "管理员调整",
  generation_reserve: "官方生成预留",
  generation_capture: "官方生成扣除",
  generation_release: "官方生成退回",
};

function errorText(error: unknown) {
  return error instanceof CloudApiError
    ? error.message
    : "请求未完成，请稍后重试";
}

export function CreditSettingsPanel() {
  const [preferences, setPreferences] =
    useState<OfficialGenerationPreferences | null>(null);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [entries, setEntries] = useState<CreditLedgerEntry[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [nextPreferences, nextBalance, ledger] = await Promise.all([
        fetchOfficialGenerationPreferences(),
        fetchCreditBalance(),
        fetchCreditLedger(),
      ]);
      setPreferences(nextPreferences);
      setBalance(nextBalance);
      setEntries(ledger.items);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function toggle() {
    if (!preferences || !preferences.platformEnabled || busy) return;
    if (
      !preferences.userEnabled &&
      !window.confirm(
        "开启后，选择官方模型生成图片会按分辨率使用对应数量。确认开启吗？",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      setPreferences(
        await updateOfficialGenerationPreferences(!preferences.userEnabled),
      );
      setNotice(
        preferences.userEnabled ? "官方接口服务已关闭" : "官方接口服务已开启",
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await redeemCreditCode(code);
      setBalance(result.balance);
      setCode("");
      setNotice(`兑换成功，已增加 ${result.credited}`);
      const ledger = await fetchCreditLedger();
      setEntries(ledger.items);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        <div className="flex min-h-20 items-center justify-between gap-5 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3
                className={`text-sm font-semibold ${themeClasses.textPrimary}`}
              >
                官方接口服务
              </h3>
              <p className={`mt-1 text-xs ${themeClasses.textMuted}`}>
                {preferences?.platformEnabled
                  ? "官方模型与我的模型分组显示"
                  : "平台暂未开放"}
              </p>
            </div>
          </div>
          <CanvasSettingsSwitch
            checked={preferences?.userEnabled ?? false}
            disabled={!preferences?.platformEnabled || busy}
            label="启用官方接口服务"
            onChange={() => void toggle()}
          />
        </div>
        <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)]">
          <div className="px-4 py-4">
            <span className={`text-xs ${themeClasses.textMuted}`}>
              可用
              <Coins
                className="ml-1 inline h-3 w-3 text-[var(--text-muted)]"
                aria-label="使用点数"
              />
            </span>
            <strong
              className={`mt-1 block text-2xl ${themeClasses.textPrimary}`}
            >
              {balance?.available ?? "--"}
            </strong>
          </div>
          <div className="px-4 py-4">
            <span className={`text-xs ${themeClasses.textMuted}`}>
              任务预留
            </span>
            <strong
              className={`mt-1 block text-2xl ${themeClasses.textPrimary}`}
            >
              {balance?.reserved ?? "--"}
            </strong>
          </div>
        </div>
      </section>

      <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-amber-400" />
          <h3 className={`text-sm font-semibold ${themeClasses.textPrimary}`}>
            兑换
          </h3>
        </div>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") void redeem();
            }}
            placeholder="输入兑换码"
            maxLength={128}
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-amber-400/50"
          />
          <button
            type="button"
            onClick={() => void redeem()}
            disabled={!code.trim() || busy}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-amber-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <BadgeCheck className="h-4 w-4" />
            )}
            兑换
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
        {notice ? (
          <p className="mt-2 text-xs text-emerald-400">{notice}</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-sky-400" />
            <h3 className={`text-sm font-semibold ${themeClasses.textPrimary}`}>
              使用记录
            </h3>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="刷新使用记录"
            className={`${themeClasses.iconButton} h-8 w-8 rounded-[8px]`}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
            />
          </button>
        </header>
        <div className="divide-y divide-[var(--border-subtle)]">
          {entries.length === 0 ? (
            <p
              className={`px-4 py-8 text-center text-xs ${themeClasses.textMuted}`}
            >
              暂无使用记录
            </p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <strong
                    className={`block truncate text-[13px] ${themeClasses.textPrimary}`}
                  >
                    {ENTRY_LABELS[entry.type]}
                  </strong>
                  <time
                    className={`mt-0.5 block text-[11px] ${themeClasses.textMuted}`}
                  >
                    {new Date(entry.createdAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </time>
                </div>
                <span
                  className={`shrink-0 font-mono text-sm ${entry.availableDelta > 0 ? "text-emerald-400" : entry.availableDelta < 0 ? "text-amber-400" : themeClasses.textMuted}`}
                >
                  {entry.availableDelta > 0 ? "+" : ""}
                  {entry.availableDelta || entry.reservedDelta}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
