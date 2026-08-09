import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CommunityProfile } from "@ai-canvas-cloud/contracts";
import { CircleAlert, Loader2, Save, UserRound } from "lucide-react";
import { CloudApiError } from "@/api/cloudApiClient";
import { themeClasses } from "@/styles/themeClasses";
import { fetchCommunityProfile, updateCommunityProfile } from "./api";
import { MyCommunityPosts } from "@/features/community/MyCommunityPosts";

const INPUT_CLASS =
  "h-10 w-full rounded-[7px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50";

function errorMessage(error: unknown) {
  if (
    error instanceof CloudApiError &&
    error.code === "PUBLIC_NICKNAME_UNAVAILABLE"
  ) {
    return "这个公开昵称已被使用，请换一个。";
  }
  return error instanceof Error ? error.message : "社区资料保存失败，请重试。";
}

export function CommunityProfileSettings() {
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [publicNickname, setPublicNickname] = useState("");
  const [communityConsent, setCommunityConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchCommunityProfile();
      setProfile(response.profile);
      setPublicNickname(response.profile.publicNickname ?? "");
      setCommunityConsent(response.profile.communityConsentVersion === 1);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await updateCommunityProfile({
        publicNickname: publicNickname.trim() || null,
        communityConsent,
      });
      setProfile(response.profile);
      setPublicNickname(response.profile.publicNickname ?? "");
      setCommunityConsent(response.profile.communityConsentVersion === 1);
      setSaved(true);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="community-profile-heading">
      <h3
        id="community-profile-heading"
        className={`mb-2 px-1 text-xs font-medium ${themeClasses.textSecondary}`}
      >
        社区公开资料
      </h3>
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)]"
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[2rem_minmax(0,1fr)]">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--control-bg-hover)] text-[var(--text-secondary)]">
            <UserRound className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-3">
            <label className="block">
              <span className={`block text-xs ${themeClasses.textMuted}`}>
                公开昵称
              </span>
              <input
                type="text"
                value={publicNickname}
                onChange={(event) => {
                  setPublicNickname(event.target.value);
                  setSaved(false);
                }}
                disabled={loading || saving}
                maxLength={32}
                autoComplete="nickname"
                placeholder="设置社区展示昵称"
                className={`mt-1.5 ${INPUT_CLASS}`}
              />
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 py-3">
              <input
                type="checkbox"
                checked={communityConsent}
                onChange={(event) => {
                  setCommunityConsent(event.target.checked);
                  setSaved(false);
                }}
                disabled={loading || saving}
                className="mt-0.5 h-4 w-4 accent-violet-500"
              />
              <span className="min-w-0 text-xs leading-5 text-[var(--text-secondary)]">
                我同意将主动投稿的图片、标题、标签、发布时间和公开昵称用于社区展示。未投稿的私有资产不会公开。
              </span>
            </label>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 text-xs text-red-500 dark:text-red-300"
              >
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`text-[11px] ${themeClasses.textMuted}`}>
                {loading
                  ? "正在读取社区资料..."
                  : profile?.canPost
                    ? "社区投稿授权已开启"
                    : "社区投稿授权未开启"}
              </span>
              <div className="flex items-center gap-2">
                {error && !profile ? (
                  <button
                    type="button"
                    onClick={() => void load()}
                    className={BUTTON_CLASS}
                  >
                    重试
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={loading || saving}
                  className={BUTTON_CLASS}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {saving ? "正在保存" : saved ? "已保存" : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
      {profile ? <MyCommunityPosts /> : null}
    </section>
  );
}
