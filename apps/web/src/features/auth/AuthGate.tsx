import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  LogIn,
  ShieldAlert,
  UserPlus,
  X,
} from "lucide-react";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  CloudApiError,
} from "@/api/cloudApiClient";
import {
  requestAuthPasswordReset,
  resetAuthPassword,
  verifyAuthEmail,
} from "./api";
import { PublicHome } from "./PublicHome";
import {
  SESSION_HEARTBEAT_INTERVAL_MS,
  shouldProbeSession,
} from "./sessionProbe";
import { useAuthStore } from "./useAuthStore";
import { themeClasses } from "@/styles/themeClasses";

interface AuthGateProps {
  children: ReactNode;
}

type AuthMode = "login" | "register" | "forgot" | "reset";
type AuthModalAnimationPhase = "enter" | "settled" | "out" | "in";

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,29}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "root",
  "support",
  "system",
]);

function getUsernameValidationMessage(value: string) {
  if (!value) {
    return "请输入用户名";
  }

  if (!USERNAME_PATTERN.test(value)) {
    return "用户名需为 3–30 位，首字符为字母，仅支持字母、数字和下划线";
  }

  if (RESERVED_USERNAMES.has(value.toLocaleLowerCase("en-US"))) {
    return "该用户名不可使用，请更换后重试";
  }

  return null;
}

function getSubmitLabel(mode: AuthMode, pending: boolean) {
  if (pending) {
    if (mode === "login") {
      return "正在登录...";
    }

    if (mode === "register") {
      return "正在创建...";
    }

    if (mode === "forgot") {
      return "正在发送...";
    }

    return "正在重置...";
  }

  if (mode === "login") {
    return "登录";
  }

  if (mode === "register") {
    return "创建账号";
  }

  if (mode === "forgot") {
    return "发送重置链接";
  }

  return "重置密码";
}

function getSubmitErrorMessage(mode: AuthMode, error: unknown) {
  if (mode === "login") {
    return "账号或密码错误";
  }

  if (
    mode === "register" &&
    error instanceof CloudApiError &&
    error.code === "USERNAME_UNAVAILABLE"
  ) {
    return "该用户名已被使用，请更换后重试。";
  }

  return error instanceof Error ? error.message : String(error);
}

export function AuthGate({ children }: AuthGateProps) {
  const status = useAuthStore((state) => state.status);
  const session = useAuthStore((state) => state.session);
  const checkSession = useAuthStore((state) => state.checkSession);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const [mode, setMode] = useState<AuthMode>("login");
  const [authModalAnimationPhase, setAuthModalAnimationPhase] =
    useState<AuthModalAnimationPhase>("enter");
  const [pendingAuthMode, setPendingAuthMode] = useState<Extract<
    AuthMode,
    "login" | "register"
  > | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(() =>
    window.location.pathname.startsWith("/auth/"),
  );
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [loginConflict, setLoginConflict] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailVerificationStatus, setEmailVerificationStatus] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [emailVerificationMessage, setEmailVerificationMessage] = useState<
    string | null
  >(null);
  const verificationConsumedRef = useRef(false);
  const sessionProbeInFlightRef = useRef(false);
  const lastSessionProbeAtRef = useRef(0);

  const openAuth = (nextMode: Extract<AuthMode, "login" | "register">) => {
    setSubmitError(null);
    setSubmitMessage(null);
    setLoginConflict(false);

    const shouldFlip =
      isAuthOpen &&
      (mode === "login" || mode === "register") &&
      mode !== nextMode &&
      authModalAnimationPhase !== "out" &&
      authModalAnimationPhase !== "in" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (shouldFlip) {
      setPendingAuthMode(nextMode);
      setAuthModalAnimationPhase("out");
      return;
    }

    setPendingAuthMode(null);
    setAuthModalAnimationPhase(isAuthOpen ? "settled" : "enter");
    setMode(nextMode);
    setIsAuthOpen(true);
  };

  const closeAuth = useCallback(() => {
    if (window.location.pathname.startsWith("/auth/")) {
      window.history.replaceState(null, "", "/");
    }

    setIsAuthOpen(false);
    setMode("login");
    setPendingAuthMode(null);
    setAuthModalAnimationPhase("enter");
    setResetToken(null);
    setSubmitError(null);
    setSubmitMessage(null);
    setLoginConflict(false);
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    const handleSessionExpired = () => {
      void checkSession();
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      window.removeEventListener(
        AUTH_SESSION_EXPIRED_EVENT,
        handleSessionExpired,
      );
    };
  }, [checkSession]);

  useEffect(() => {
    if (!isAuthOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        closeAuth();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAuth, isAuthOpen, isSubmitting]);

  useEffect(() => {
    if (status !== "authenticated" || !session || mode === "reset") {
      return;
    }

    lastSessionProbeAtRef.current = Date.now();

    const probeSession = () => {
      const now = Date.now();

      if (
        !shouldProbeSession({
          now,
          lastProbeAt: lastSessionProbeAtRef.current,
          inFlight: sessionProbeInFlightRef.current,
        })
      ) {
        return;
      }

      sessionProbeInFlightRef.current = true;
      lastSessionProbeAtRef.current = now;

      void checkSession({ silent: true }).finally(() => {
        sessionProbeInFlightRef.current = false;
      });
    };

    const probeVisibleSession = () => {
      if (document.visibilityState === "visible") {
        probeSession();
      }
    };

    const heartbeatId = window.setInterval(
      probeVisibleSession,
      SESSION_HEARTBEAT_INTERVAL_MS,
    );
    window.addEventListener("focus", probeVisibleSession);
    document.addEventListener("visibilitychange", probeVisibleSession);

    return () => {
      window.clearInterval(heartbeatId);
      window.removeEventListener("focus", probeVisibleSession);
      document.removeEventListener("visibilitychange", probeVisibleSession);
    };
  }, [checkSession, mode, session, status]);

  useEffect(() => {
    if (window.location.pathname !== "/auth/reset-password") {
      return;
    }

    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
      setMode("forgot");
      setSubmitError("重置链接缺少 token，请重新发送重置邮件。");
      return;
    }

    setResetToken(token);
    setMode("reset");
  }, []);

  useEffect(() => {
    if (
      verificationConsumedRef.current ||
      window.location.pathname !== "/auth/verify-email"
    ) {
      return;
    }

    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
      return;
    }

    verificationConsumedRef.current = true;
    setEmailVerificationStatus("pending");
    setEmailVerificationMessage("正在验证邮箱...");

    verifyAuthEmail({ token })
      .then(async () => {
        window.history.replaceState(null, "", "/");
        setEmailVerificationStatus("success");
        setEmailVerificationMessage(
          "邮箱已验证，可以继续使用 AI Canvas Cloud。",
        );
        await checkSession();
      })
      .catch((error: unknown) => {
        window.history.replaceState(null, "", "/");
        setEmailVerificationStatus("error");
        setEmailVerificationMessage(
          error instanceof Error ? error.message : String(error),
        );
      });
  }, [checkSession]);

  const helperText = useMemo(() => {
    if (mode === "login") {
      return "登录后继续访问你的项目。";
    }

    if (mode === "register") {
      return "注册后即可创建和管理多个项目。";
    }

    if (mode === "forgot") {
      return "输入邮箱后，我们会发送一封密码重置邮件。";
    }

    return "设置一个新密码，重置成功后请重新登录。";
  }, [mode]);
  const isAuthModeTransitioning =
    authModalAnimationPhase === "out" || authModalAnimationPhase === "in";
  const authFlipDirection =
    (pendingAuthMode ?? mode) === "register" ? "forward" : "backward";
  const usernameValidationMessage =
    mode === "register" && username.length > 0
      ? getUsernameValidationMessage(username)
      : null;

  const handleAuthModeAnimationEnd = (
    event: React.AnimationEvent<HTMLElement>,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (authModalAnimationPhase === "enter") {
      setAuthModalAnimationPhase("settled");
      return;
    }

    if (authModalAnimationPhase === "out" && pendingAuthMode) {
      setMode(pendingAuthMode);
      setAuthModalAnimationPhase("in");
      return;
    }

    if (authModalAnimationPhase === "in") {
      setPendingAuthMode(null);
      setAuthModalAnimationPhase("settled");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitMessage(null);
    setLoginConflict(false);

    if (mode === "register") {
      const validationMessage = getUsernameValidationMessage(username);
      if (validationMessage) {
        setSubmitError(validationMessage);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await login({ identifier, password });
      } else if (mode === "register") {
        await register({ username, email, password });
      } else if (mode === "forgot") {
        await requestAuthPasswordReset({ email });
        setSubmitMessage("如果这个邮箱存在，我们已经发送了密码重置链接。");
      } else {
        if (!resetToken) {
          throw new Error("重置链接缺少 token，请重新发送重置邮件。");
        }

        if (password !== confirmPassword) {
          throw new Error("两次输入的新密码不一致");
        }

        await resetAuthPassword({ token: resetToken, password });
        window.history.replaceState(null, "", "/");
        setPassword("");
        setConfirmPassword("");
        setResetToken(null);
        setMode("login");
        setSubmitMessage("密码已重置，请用新密码登录。");
      }
    } catch (error) {
      if (
        mode === "login" &&
        error instanceof CloudApiError &&
        error.code === "ACTIVE_SESSION_EXISTS"
      ) {
        setLoginConflict(true);
      } else {
        setSubmitError(getSubmitErrorMessage(mode, error));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmLoginTakeover = async () => {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      await login({ identifier, password, force: true });
    } catch (error) {
      setLoginConflict(false);
      setSubmitError(getSubmitErrorMessage("login", error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === "checking") {
    return (
      <div
        className={`flex min-h-screen items-center justify-center ${themeClasses.canvas}`}
      >
        <div
          className={`inline-flex items-center gap-2 text-sm ${themeClasses.textMuted}`}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          正在恢复会话...
        </div>
      </div>
    );
  }

  if (status === "authenticated" && session && mode !== "reset") {
    return children;
  }

  return (
    <>
      <PublicHome
        onLogin={() => openAuth("login")}
        onRegister={() => openAuth("register")}
      />

      {isAuthOpen ? (
        <div
          className="auth-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !isSubmitting &&
              !isAuthModeTransitioning
            ) {
              closeAuth();
            }
          }}
        >
          <section
            className={`auth-modal ${themeClasses.strongPanel}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            aria-busy={isSubmitting || isAuthModeTransitioning}
            data-flip-phase={authModalAnimationPhase}
            data-flip-direction={authFlipDirection}
            onAnimationEnd={handleAuthModeAnimationEnd}
          >
            <button
              type="button"
              className="auth-modal__close"
              onClick={closeAuth}
              disabled={isSubmitting || isAuthModeTransitioning}
              aria-label="关闭"
            >
              <X aria-hidden="true" />
            </button>

            <div className="auth-modal__header">
              <img
                src="/brand/ai-canvas-mark.png"
                alt=""
                width="42"
                height="42"
              />
              <div>
                <h2 id="auth-modal-title">
                  {mode === "login"
                    ? "欢迎回来"
                    : mode === "register"
                      ? "创建 Cloud 账号"
                      : mode === "forgot"
                        ? "找回密码"
                        : "重置密码"}
                </h2>
                <p>{helperText}</p>
              </div>
            </div>

            {mode === "login" || mode === "register" ? (
              <div
                className="auth-mode-switch"
                data-mode={mode}
                aria-label="认证方式"
              >
                <button
                  type="button"
                  data-active={mode === "login"}
                  disabled={isAuthModeTransitioning}
                  onClick={() => openAuth("login")}
                >
                  登录
                </button>
                <button
                  type="button"
                  data-active={mode === "register"}
                  disabled={isAuthModeTransitioning}
                  onClick={() => openAuth("register")}
                >
                  注册
                </button>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="auth-modal__form">
              {mode === "register" ? (
                <label className="block">
                  <span
                    className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}
                  >
                    用户名
                  </span>
                  <input
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setSubmitError(null);
                    }}
                    type="text"
                    autoComplete="username"
                    autoFocus
                    required
                    minLength={3}
                    maxLength={30}
                    pattern="[A-Za-z][A-Za-z0-9_]{2,29}"
                    aria-invalid={Boolean(usernameValidationMessage)}
                    aria-describedby="register-username-hint"
                    className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
                    placeholder="hello_01"
                  />
                  <span
                    id="register-username-hint"
                    className={`mt-1.5 block text-[11px] leading-4 ${
                      usernameValidationMessage
                        ? "text-red-500 dark:text-red-300"
                        : themeClasses.textMuted
                    }`}
                  >
                    {usernameValidationMessage ??
                      "3–30 位，首字符为字母，仅支持字母、数字和下划线"}
                  </span>
                </label>
              ) : null}

              {mode === "login" ? (
                <label className="block">
                  <span
                    className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}
                  >
                    用户名或邮箱
                  </span>
                  <input
                    value={identifier}
                    onChange={(event) => {
                      setIdentifier(event.target.value);
                      setSubmitError(null);
                      setLoginConflict(false);
                    }}
                    type="text"
                    autoComplete="username"
                    autoFocus
                    required
                    className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
                    placeholder="用户名或 you@example.com"
                  />
                </label>
              ) : null}

              {mode === "register" || mode === "forgot" ? (
                <label className="block">
                  <span
                    className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}
                  >
                    邮箱
                  </span>
                  <input
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setSubmitError(null);
                      setLoginConflict(false);
                    }}
                    type="email"
                    autoComplete="email"
                    autoFocus={mode === "forgot"}
                    required
                    className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
                    placeholder="you@example.com"
                  />
                </label>
              ) : null}

              {mode !== "forgot" ? (
                <label className="block">
                  <span
                    className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}
                  >
                    {mode === "reset" ? "新密码" : "密码"}
                  </span>
                  <div className="relative">
                    <input
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setSubmitError(null);
                        setLoginConflict(false);
                      }}
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      autoFocus={mode === "reset"}
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
              ) : null}

              {mode === "reset" ? (
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
                      setSubmitError(null);
                    }}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={10}
                    className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
                    placeholder="再次输入新密码"
                  />
                </label>
              ) : null}

              {submitError ? (
                <div className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200">
                  {submitError}
                </div>
              ) : null}

              {submitMessage ? (
                <div className="rounded-[8px] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-200">
                  {submitMessage}
                </div>
              ) : null}

              {emailVerificationStatus !== "idle" &&
              emailVerificationMessage ? (
                <div
                  className={`rounded-[8px] border px-3 py-2 text-xs leading-5 ${
                    emailVerificationStatus === "error"
                      ? "border-red-400/20 bg-red-500/10 text-red-200"
                      : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                  }`}
                >
                  {emailVerificationStatus === "pending" ? (
                    <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin align-[-2px]" />
                  ) : null}
                  {emailVerificationMessage}
                </div>
              ) : null}

              {mode === "login" && loginConflict ? (
                <div className="rounded-[10px] border border-amber-400/25 bg-amber-400/8 p-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <div className="min-w-0">
                      <div
                        className={`text-xs font-semibold ${themeClasses.textPrimary}`}
                      >
                        账号已在其他设备登录
                      </div>
                      <p
                        className={`mt-1 text-[11px] leading-5 ${themeClasses.textMuted}`}
                      >
                        继续登录后，原设备会立即退出；设备记录仍会保留在设备管理中。
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setLoginConflict(false)}
                      className="h-8 rounded-[7px] px-3 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleConfirmLoginTakeover()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-violet-500 px-3 text-xs font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LogIn className="h-3.5 w-3.5" />
                      )}
                      继续登录
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="auth-modal__submit"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : mode === "login" ? (
                    <LogIn className="h-4 w-4" />
                  ) : mode === "register" ? (
                    <UserPlus className="h-4 w-4" />
                  ) : (
                    <LockKeyhole className="h-4 w-4" />
                  )}
                  {getSubmitLabel(mode, isSubmitting)}
                </button>
              )}
            </form>

            <div className="auth-modal__footer">
              {mode === "login" ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setSubmitError(null);
                    setSubmitMessage(null);
                  }}
                >
                  忘记密码？
                </button>
              ) : mode === "forgot" || mode === "reset" ? (
                <button
                  type="button"
                  onClick={() => {
                    window.history.replaceState(null, "", "/");
                    openAuth("login");
                    setResetToken(null);
                  }}
                >
                  返回登录
                </button>
              ) : (
                <span>注册后即可开始创建云端项目</span>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
