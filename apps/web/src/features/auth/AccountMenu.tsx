import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { AuthSessionResponse } from "@ai-canvas-cloud/contracts";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  HardDrive,
  IdCard,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MonitorCheck,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { changeAuthPassword } from "./api";
import { useAuthStore } from "./useAuthStore";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useSettingsDialogStore } from "@/store/useSettingsDialogStore";
import { themeClasses } from "@/styles/themeClasses";

const ACCOUNT_GROUP_CLASS =
  "overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)]";
const ACCOUNT_ROW_CLASS =
  "grid min-h-16 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]";
const ACCOUNT_ICON_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--control-bg-hover)] text-[var(--text-secondary)]";
const ACCOUNT_ACTION_CLASS =
  "col-start-2 inline-flex min-h-11 items-center justify-center gap-1.5 justify-self-start rounded-[7px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50 sm:col-start-3 sm:row-start-1 sm:min-h-8 sm:justify-self-end sm:px-2.5";

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Clipboard API timed out")),
            750,
          );
        }),
      ]);
      return;
    } catch {
      // Some embedded browsers expose Clipboard API without resolving writes.
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("浏览器未允许复制");
  }
}

function PasswordChangeDialog({
  onClose,
  onPasswordChanged,
}: {
  onClose: () => void;
  onPasswordChanged: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(
    true,
    onClose,
    "#account-password-current",
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    if (currentPassword === password) {
      setError("新密码不能与当前密码相同");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await changeAuthPassword({
        currentPassword,
        newPassword: password,
      });
      await onPasswordChanged();
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "密码修改失败，请稍后重试。",
      );
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-password-change-heading"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-xl overflow-hidden rounded-[10px] shadow-[0_24px_64px_rgba(0,0,0,0.45)] ${themeClasses.strongPanel}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2
              id="account-password-change-heading"
              className={`text-[15px] font-semibold ${themeClasses.textPrimary}`}
            >
              修改密码
            </h2>
            <p className={`mt-1 text-xs leading-5 ${themeClasses.textMuted}`}>
              验证当前密码后设置新密码。完成修改后，所有设备都需要重新登录。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="关闭修改密码窗口"
            title="关闭"
            className={`${themeClasses.iconButton} h-8 w-8 shrink-0 rounded-[8px]`}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-4 px-5 py-5"
        >
          <label className="block">
            <span
              className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}
            >
              当前密码
            </span>
            <input
              id="account-password-current"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
                setError(null);
              }}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              required
              minLength={10}
              className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
              placeholder="输入当前密码"
            />
          </label>

          <label className="block">
            <span
              className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}
            >
              新密码
            </span>
            <div className="relative">
              <input
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={10}
                className={`h-11 w-full px-3 pr-11 text-sm ${themeClasses.input}`}
                placeholder="至少 10 个字符"
              />
              <button
                type="button"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((current) => !current)}
                className={`${themeClasses.iconButton} absolute right-1.5 top-1.5 h-8 w-8`}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>

          <label className="block">
            <span
              className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}
            >
              确认新密码
            </span>
            <input
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setError(null);
              }}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
              placeholder="再次输入新密码"
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-[7px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-200"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[7px] px-3 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[7px] bg-violet-500 px-4 text-xs font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              {isSubmitting ? "正在修改..." : "修改密码"}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

export function AccountMenu() {
  const session = useAuthStore((state) => state.session);
  const logout = useAuthStore((state) => state.logout);
  const openSettings = useSettingsDialogStore((state) => state.open);
  const activeSettingsCategory = useSettingsDialogStore(
    (state) => state.activeCategory,
  );
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!session) {
    return null;
  }

  const openSettingsCategory = (
    category: "account" | "devices" | "storage",
  ) => {
    setIsOpen(false);
    openSettings(category);
  };

  const menuItemClass =
    "group flex min-h-8 w-full items-center gap-2 rounded-[6px] px-1.5 text-left text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        title={session.user.username}
        aria-label="用户菜单"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`${themeClasses.iconButton} h-6 w-6 rounded-md`}
      >
        <UserRound className="h-3.5 w-3.5" />
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label="用户菜单"
          className={`absolute right-0 top-8 z-50 w-[180px] overflow-hidden rounded-[8px] ${themeClasses.strongPanel}`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-violet-400/25 bg-violet-400/10 text-violet-300">
              <UserRound className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span
                className={`block truncate text-[11px] font-semibold ${themeClasses.textPrimary}`}
              >
                {session.user.username}
              </span>
              <span
                className={`mt-0.5 block truncate text-[9px] ${themeClasses.textMuted}`}
              >
                {session.user.email}
              </span>
            </span>
          </div>

          <div className="space-y-0.5 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => openSettingsCategory("storage")}
              className={menuItemClass}
            >
              <HardDrive className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">存储空间</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openSettingsCategory("devices")}
              className={menuItemClass}
            >
              <MonitorCheck className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">登录设备</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openSettingsCategory("account")}
              className={menuItemClass}
            >
              <IdCard className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">个人资料</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                openSettings(activeSettingsCategory);
              }}
              className={menuItemClass}
            >
              <Settings className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">设置</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>

          <div className="border-t border-[var(--border-subtle)] bg-[var(--control-bg)] p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                void logout();
              }}
              className={menuItemClass}
            >
              <LogOut className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">退出登录</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AccountSettingsPanel() {
  const session = useAuthStore((state) => state.session);

  if (!session) {
    return null;
  }

  return <AccountSettingsContent session={session} />;
}

export function AccountSettingsContent({
  session,
}: {
  session: AuthSessionResponse;
}) {
  const logout = useAuthStore((state) => state.logout);
  const setActiveCategory = useSettingsDialogStore(
    (state) => state.setActiveCategory,
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [isPasswordChangeOpen, setIsPasswordChangeOpen] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  const accountInitial =
    session.user.username.trim().charAt(0).toLocaleUpperCase() || "U";
  const scheduleCopyStateReset = () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }

    copyResetTimerRef.current = setTimeout(() => {
      setCopyState("idle");
      copyResetTimerRef.current = null;
    }, 2_000);
  };

  const handleCopyUserNumber = async () => {
    try {
      await copyTextToClipboard(String(session.user.userNumber));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    } finally {
      scheduleCopyStateReset();
    }
  };

  const handlePasswordChange = () => {
    setIsPasswordChangeOpen(true);
  };

  const handlePasswordChanged = async () => {
    await logout();
    window.location.assign("/auth/login");
  };

  return (
    <>
      <section className="mx-auto w-full max-w-4xl space-y-5">
        <header className="flex flex-col items-start gap-4 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-violet-400/25 bg-violet-400/10 text-base font-semibold text-violet-500 dark:text-violet-300"
            >
              {accountInitial}
            </span>
            <span className="min-w-0">
              <span
                className={`block break-all text-sm font-semibold sm:truncate ${themeClasses.textPrimary}`}
                title={session.user.username}
              >
                {session.user.username}
              </span>
              <span
                className={`mt-1 block truncate text-xs ${themeClasses.textMuted}`}
              >
                {session.user.email} · UID {session.user.userNumber}
              </span>
            </span>
          </div>

          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium ${
              session.user.emailVerified
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300"
                : "border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-300"
            }`}
          >
            {session.user.emailVerified ? (
              <ShieldCheck className="h-3 w-3" />
            ) : (
              <ShieldAlert className="h-3 w-3" />
            )}
            {session.user.emailVerified ? "邮箱已验证" : "邮箱待验证"}
          </span>
        </header>

        <section aria-labelledby="account-information-heading">
          <h3
            id="account-information-heading"
            className={`mb-2 px-1 text-xs font-medium ${themeClasses.textSecondary}`}
          >
            账号信息
          </h3>
          <div
            className={`${ACCOUNT_GROUP_CLASS} divide-y divide-[var(--border-subtle)]`}
          >
            <div className={ACCOUNT_ROW_CLASS}>
              <span className={ACCOUNT_ICON_CLASS}>
                <UserRound className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={`block text-xs ${themeClasses.textMuted}`}>
                  用户名
                </span>
                <span
                  className={`mt-1 block truncate text-sm font-medium ${themeClasses.textPrimary}`}
                  title={session.user.username}
                >
                  {session.user.username}
                </span>
              </span>
              <span className="col-start-2 justify-self-start text-[11px] text-[var(--text-muted)] sm:col-start-3 sm:row-start-1 sm:justify-self-end">
                不可修改
              </span>
            </div>

            <div className={ACCOUNT_ROW_CLASS}>
              <span className={ACCOUNT_ICON_CLASS}>
                <Mail className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={`block text-xs ${themeClasses.textMuted}`}>
                  邮箱地址
                </span>
                <span
                  className={`mt-1 block break-all text-sm font-medium sm:truncate ${themeClasses.textPrimary}`}
                  title={session.user.email}
                >
                  {session.user.email}
                </span>
              </span>
            </div>

            <div className={ACCOUNT_ROW_CLASS}>
              <span className={ACCOUNT_ICON_CLASS}>
                <IdCard className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={`block text-xs ${themeClasses.textMuted}`}>
                  用户编号
                </span>
                <span
                  className={`mt-1 block font-mono text-sm font-semibold ${themeClasses.textPrimary}`}
                >
                  UID {session.user.userNumber}
                </span>
                {copyState === "error" ? (
                  <span
                    role="alert"
                    className="mt-1 block text-[11px] text-red-500 dark:text-red-200"
                  >
                    复制失败，请重试。
                  </span>
                ) : null}
                {copyState === "copied" ? (
                  <span role="status" className="sr-only">
                    用户编号已复制
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyUserNumber()}
                aria-label={
                  copyState === "copied" ? "用户编号已复制" : "复制用户编号"
                }
                title={copyState === "copied" ? "已复制" : "复制用户编号"}
                className={`${ACCOUNT_ACTION_CLASS} h-11 w-11 px-0 sm:h-8 sm:w-8 sm:px-0`}
              >
                {copyState === "copied" ? (
                  <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />
                ) : copyState === "error" ? (
                  <CircleAlert className="h-4 w-4 text-red-500 dark:text-red-300" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </section>

        <section aria-labelledby="account-security-heading">
          <h3
            id="account-security-heading"
            className={`mb-2 px-1 text-xs font-medium ${themeClasses.textSecondary}`}
          >
            账号安全
          </h3>
          <div
            className={`${ACCOUNT_GROUP_CLASS} divide-y divide-[var(--border-subtle)]`}
          >
            <div className={ACCOUNT_ROW_CLASS}>
              <span className={ACCOUNT_ICON_CLASS}>
                <KeyRound className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-sm font-medium ${themeClasses.textPrimary}`}
                >
                  登录密码
                </span>
                <span
                  className={`mt-1 block text-xs leading-5 ${themeClasses.textMuted}`}
                >
                  验证当前密码后设置新密码；完成修改后所有设备需重新登录。
                </span>
              </span>
              <button
                type="button"
                onClick={handlePasswordChange}
                className={ACCOUNT_ACTION_CLASS}
              >
                修改密码
              </button>
            </div>

            <div className={ACCOUNT_ROW_CLASS}>
              <span className={ACCOUNT_ICON_CLASS}>
                <MonitorCheck className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-sm font-medium ${themeClasses.textPrimary}`}
                >
                  登录设备
                </span>
                <span
                  className={`mt-1 block text-xs leading-5 ${themeClasses.textMuted}`}
                >
                  查看当前设备和历史登录记录。
                </span>
              </span>
              <button
                type="button"
                onClick={() => setActiveCategory("devices")}
                className={ACCOUNT_ACTION_CLASS}
              >
                管理设备
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </section>
      </section>
      {isPasswordChangeOpen ? (
        <PasswordChangeDialog
          onClose={() => setIsPasswordChangeOpen(false)}
          onPasswordChanged={handlePasswordChanged}
        />
      ) : null}
    </>
  );
}
