import { lazy, Suspense } from "react";
import {
  AuthenticatedAppBoundary,
  AuthenticatedAppLoading,
} from "@/components/AuthenticatedAppBoundary";
import { PublicThemeProvider } from "@/components/PublicThemeProvider";
import { AuthGate } from "@/features/auth/AuthGate";
import { PublicContentPage } from "@/features/public/PublicContentPage";
import { getPublicPageKind } from "@/features/public/publicPages";

const AuthenticatedApp = lazy(() => import("@/AuthenticatedApp"));

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
        <PublicContentPage kind={publicPageKind} />
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
