import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { useFeedbackStore, type FeedbackToast, type FeedbackToastTone } from '@/store/useFeedbackStore'
import { themeClasses } from '@/styles/themeClasses'

const toastToneClassName: Record<FeedbackToastTone, string> = {
  info: 'border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)]',
  success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-600 dark:text-emerald-200',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-200',
  error: 'border-red-400/25 bg-red-500/10 text-red-500 dark:text-red-200',
}

function ToastIcon({ tone }: { tone: FeedbackToastTone }) {
  const className = 'h-4 w-4'

  if (tone === 'success') {
    return <CheckCircle2 className={className} />
  }

  if (tone === 'warning') {
    return <AlertTriangle className={className} />
  }

  if (tone === 'error') {
    return <XCircle className={className} />
  }

  return <Info className={className} />
}

function FeedbackToastItem({ toast }: { toast: FeedbackToast }) {
  const dismissToast = useFeedbackStore((state) => state.dismissToast)

  useEffect(() => {
    if (toast.durationMs <= 0) {
      return
    }

    const timer = window.setTimeout(() => dismissToast(toast.id), toast.durationMs)
    return () => window.clearTimeout(timer)
  }, [dismissToast, toast.durationMs, toast.id])

  return (
    <div className={`flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border p-3 shadow-[var(--shadow-panel)] backdrop-blur-2xl ${themeClasses.strongPanel}`}>
      <div className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${toastToneClassName[toast.tone]}`}>
        <ToastIcon tone={toast.tone} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold leading-5 ${themeClasses.textPrimary}`}>{toast.title}</div>
        {toast.message ? <div className={`mt-1 text-xs leading-5 ${themeClasses.textMuted}`}>{toast.message}</div> : null}
      </div>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={() => dismissToast(toast.id)}
        className={`${themeClasses.iconButton} h-7 w-7 shrink-0`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function AppFeedbackHost() {
  const toasts = useFeedbackStore((state) => state.toasts)
  const confirmRequest = useFeedbackStore((state) => state.confirmRequest)
  const resolveConfirm = useFeedbackStore((state) => state.resolveConfirm)
  const confirmDialogRef = useDialogFocus<HTMLDivElement>(Boolean(confirmRequest), () => resolveConfirm(false))

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex flex-col items-end gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <FeedbackToastItem toast={toast} />
          </div>
        ))}
      </div>

      {confirmRequest ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/32 px-4 py-6 backdrop-blur-sm">
          <div
            ref={confirmDialogRef}
            className={`w-full max-w-sm rounded-xl p-5 ${themeClasses.strongPanel}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${confirmRequest.id}-title`}
            tabIndex={-1}
            data-testid="feedback-confirm-dialog"
          >
            <div className={`text-base font-semibold ${themeClasses.textPrimary}`} id={`${confirmRequest.id}-title`}>
              {confirmRequest.title}
            </div>
            <div className={`mt-2 text-sm leading-6 ${themeClasses.textMuted}`}>{confirmRequest.message}</div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => resolveConfirm(false)}
                data-testid="feedback-confirm-cancel"
                className={`${themeClasses.secondaryButton} h-9 px-3.5 text-xs font-semibold`}
              >
                {confirmRequest.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => resolveConfirm(true)}
                data-testid="feedback-confirm-submit"
                className={`inline-flex h-9 items-center justify-center rounded-xl px-3.5 text-xs font-semibold text-white transition ${
                  confirmRequest.tone === 'danger'
                    ? 'bg-red-500 hover:bg-red-400'
                    : 'bg-[var(--accent-violet)] hover:bg-[var(--accent-violet-strong)]'
                }`}
              >
                {confirmRequest.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
