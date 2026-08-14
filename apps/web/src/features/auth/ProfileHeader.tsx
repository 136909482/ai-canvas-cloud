import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  CircleAlert,
  Loader2,
  Pencil,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { AuthSessionResponse } from "@ai-canvas-cloud/contracts";
import { CloudApiError } from "@/api/cloudApiClient";
import { themeClasses } from "@/styles/themeClasses";
import { fetchCommunityProfile, updateCommunityProfile } from "./api";

const AVATAR_CLASS =
  "flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border border-violet-400/25 bg-violet-400/10 text-lg font-semibold text-violet-500 dark:text-violet-300";
const EDIT_INPUT_CLASS =
  "h-9 w-44 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-56";
const ACTION_BUTTON_CLASS =
  "inline-flex h-9 items-center justify-center gap-1 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50";
const ICON_BUTTON_CLASS =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50";

export function ProfileHeader({ session }: { session: AuthSessionResponse }) {
  const [nickname, setNickname] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchCommunityProfile();
      setNickname(response.profile.publicNickname);
      setDraft(response.profile.publicNickname ?? "");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "昵称读取失败，请重试。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    setDraft(nickname ?? "");
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(nickname ?? "");
    setError(null);
    setSaved(false);
    setEditing(false);
  };

  const flashSaved = () => {
    setSaved(true);
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => setSaved(false), 2_000);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim() || null;
    setSaving(true);
    setError(null);
    try {
      const response = await updateCommunityProfile({ publicNickname: next });
      setNickname(response.profile.publicNickname);
      setDraft(response.profile.publicNickname ?? "");
      setEditing(false);
      flashSaved();
    } catch (saveError) {
      setError(
        saveError instanceof CloudApiError &&
          saveError.code === "PUBLIC_NICKNAME_UNAVAILABLE"
          ? "这个昵称已被使用，请换一个。"
          : saveError instanceof Error
            ? saveError.message
            : "昵称保存失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  };

  const initial =
    (nickname ?? session.user.username).trim().charAt(0).toLocaleUpperCase() ||
    "U";

  return (
    <header className="flex flex-col items-start gap-4 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <span aria-hidden="true" className={AVATAR_CLASS}>
          {initial}
        </span>
        <span className="min-w-0">
          {editing ? (
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                maxLength={32}
                autoComplete="nickname"
                placeholder="设置社区展示昵称"
                aria-label="用户昵称"
                className={EDIT_INPUT_CLASS}
              />
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className={ACTION_BUTTON_CLASS}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving || loading}
                  className={ACTION_BUTTON_CLASS}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {saving ? "正在保存" : "保存"}
                </button>
              </span>
            </form>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={`block break-all text-base font-semibold sm:truncate ${
                  nickname ? themeClasses.textPrimary : themeClasses.textMuted
                }`}
              >
                {loading
                  ? "正在读取昵称..."
                  : nickname
                    ? nickname
                    : "未设置昵称"}
              </span>
              {saved ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500 dark:text-emerald-300">
                  <Check className="h-3 w-3" />
                  已保存
                </span>
              ) : null}
              <button
                type="button"
                onClick={startEdit}
                disabled={loading}
                aria-label="修改昵称"
                title="修改昵称"
                className={ICON_BUTTON_CLASS}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          <span
            className={`mt-1 block truncate text-xs ${themeClasses.textMuted}`}
          >
            @{session.user.username} · UID {session.user.userNumber}
          </span>
          {error ? (
            <span
              role="alert"
              className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-500 dark:text-red-300"
            >
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{error}</span>
            </span>
          ) : null}
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
  );
}
