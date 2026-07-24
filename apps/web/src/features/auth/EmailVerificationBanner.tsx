import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { resendAuthVerificationEmail } from "./api";
import { useAuthStore } from "./useAuthStore";

export function EmailVerificationBanner() {
  const session = useAuthStore((state) => state.session);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session || session.user.emailVerified) {
    return null;
  }

  const handleResend = async () => {
    setIsSending(true);
    setMessage(null);
    setError(null);

    try {
      await resendAuthVerificationEmail();
      setMessage("验证邮件已发送，请查看邮箱。");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="pointer-events-none absolute left-1/2 top-14 z-40 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2">
      <div className="pointer-events-auto flex items-start gap-3 rounded-[14px] border border-amber-300/25 bg-amber-500/10 px-3 py-3 text-xs text-amber-900 shadow-[var(--shadow-panel)] backdrop-blur-xl dark:text-amber-100">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-500 dark:text-amber-200">
          <MailCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">邮箱还未验证</div>
          <div className="mt-1 leading-5 opacity-85">
            当前账号 {session.user.email}{" "}
            还没完成邮箱验证。先不影响登录使用，但正式运营前会用于找回账号和安全通知。
          </div>
          {message ? (
            <div className="mt-1 text-emerald-600 dark:text-emerald-200">
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="mt-1 text-red-500 dark:text-red-200">{error}</div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={isSending}
          onClick={() => void handleResend()}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-amber-300 px-3 text-[11px] font-semibold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          重发验证邮件
        </button>
      </div>
    </div>
  );
}
