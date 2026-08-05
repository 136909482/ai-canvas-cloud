import { lazy, Suspense } from "react";
import {
  AuthenticatedAppBoundary,
  AuthenticatedAppLoading,
} from "@/components/AuthenticatedAppBoundary";
import { PublicThemeProvider } from "@/components/PublicThemeProvider";
import { AuthGate } from "@/features/auth/AuthGate";
import { getPublicPageKind } from "@/features/public/publicPages";

const AuthenticatedApp = lazy(() => import("@/AuthenticatedApp"));
const PublicContentPage = lazy(() =>
  import("@/features/public/PublicContentPage").then((module) => ({
    default: module.PublicContentPage,
  })),
);

function AuthenticatedAppHost() {
  return (
    <AuthenticatedAppBoundary>
      <Suspense fallback={<AuthenticatedAppLoading />}>
        <AuthenticatedApp />
      </Suspense>
    </AuthenticatedAppBoundary>
  );
}

export default function App() {
  const publicPageKind = getPublicPageKind(window.location.pathname);

  if (publicPageKind) {
    return (
      <>
        <PublicThemeProvider />
        <Suspense
          fallback={
            <main className="public-page" role="status" aria-live="polite">
              正在加载...
            </main>
          }
        >
          <PublicContentPage kind={publicPageKind} />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <PublicThemeProvider />
      <AuthGate>
        <AuthenticatedAppHost />
      </AuthGate>
    </>
  );
}
