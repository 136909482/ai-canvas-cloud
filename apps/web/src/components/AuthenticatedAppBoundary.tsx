import { Component, type ErrorInfo, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { isChunkLoadError } from "@/features/auth/authenticatedAppLoading";

export function AuthenticatedAppLoading() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--canvas-bg)] px-6 text-[var(--text-primary)]"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
        <LoaderCircle
          className="h-5 w-5 animate-spin text-[var(--accent-violet)]"
          aria-hidden="true"
        />
        <span>正在加载工作区...</span>
      </div>
    </main>
  );
}

interface AuthenticatedAppBoundaryProps {
  children: ReactNode;
}

interface AuthenticatedAppBoundaryState {
  error: unknown;
}

export class AuthenticatedAppBoundary extends Component<
  AuthenticatedAppBoundaryProps,
  AuthenticatedAppBoundaryState
> {
  state: AuthenticatedAppBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error(
        "Authenticated application failed to load",
        error,
        errorInfo,
      );
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const chunkFailed = isChunkLoadError(this.state.error);
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--canvas-bg)] px-6 text-[var(--text-primary)]">
        <section
          className="w-full max-w-sm border border-[var(--border-strong)] bg-[var(--panel-bg-strong)] p-6 text-center shadow-[var(--shadow-panel)]"
          aria-labelledby="authenticated-app-error-title"
          role="alert"
        >
          <h1
            id="authenticated-app-error-title"
            className="text-base font-semibold"
          >
            {chunkFailed ? "版本已更新，请刷新" : "工作区加载失败，请刷新"}
          </h1>
          <button
            type="button"
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--accent-violet)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-violet-strong)]"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            刷新页面
          </button>
        </section>
      </main>
    );
  }
}
