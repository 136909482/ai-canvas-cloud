import { lazy, Suspense, useEffect, useState } from "react";
import type {
  AdminLoginResponse,
  AdminSessionResponse,
} from "@ai-canvas-cloud/contracts";
import { Spin } from "antd";
import { AdminShell } from "./AdminShell";
import { adminApi } from "./api";
import { ViewSkeleton } from "./components";
import { LoginScreen } from "./LoginScreen";
import type { AdminView } from "./navigation";
import { setAdminIdentity } from "./refine";

const DashboardView = lazy(() =>
  import("./DashboardView").then((module) => ({
    default: module.DashboardView,
  })),
);
const UsersView = lazy(() =>
  import("./UsersView").then((module) => ({ default: module.UsersView })),
);
const UserDetailView = lazy(() =>
  import("./UserDetailView").then((module) => ({
    default: module.UserDetailView,
  })),
);
const SiteConfigView = lazy(() =>
  import("./SiteConfigView").then((module) => ({
    default: module.SiteConfigView,
  })),
);
const SmtpSettingsView = lazy(() =>
  import("./SmtpSettingsView").then((module) => ({
    default: module.SmtpSettingsView,
  })),
);
const SecurityView = lazy(() =>
  import("./SecurityView").then((module) => ({ default: module.SecurityView })),
);
const AuditView = lazy(() =>
  import("./AuditView").then((module) => ({ default: module.AuditView })),
);

type Flow = "loading" | "login" | "app";

function Console({
  session,
  onSessionUpdated,
  onLogout,
}: {
  session: AdminSessionResponse;
  onSessionUpdated: (session: AdminSessionResponse) => void;
  onLogout: () => void;
}) {
  const [view, setView] = useState<AdminView>("dashboard");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  function navigate(nextView: AdminView) {
    setView(nextView);
    setSelectedUserId(null);
  }

  let page;
  if (view === "dashboard") page = <DashboardView />;
  else if (view === "security")
    page = (
      <SecurityView session={session} onSessionUpdated={onSessionUpdated} />
    );
  else if (view === "users")
    page = selectedUserId ? (
      <UserDetailView
        userId={selectedUserId}
        onBack={() => setSelectedUserId(null)}
      />
    ) : (
      <UsersView onSelectUser={setSelectedUserId} />
    );
  else if (view === "site") page = <SiteConfigView />;
  else if (view === "smtp") page = <SmtpSettingsView />;
  else page = <AuditView />;

  return (
    <AdminShell
      session={session}
      view={view}
      onNavigate={navigate}
      onLogout={onLogout}
    >
      <Suspense fallback={<ViewSkeleton />}>{page}</Suspense>
    </AdminShell>
  );
}

export function AdminApp() {
  const [flow, setFlow] = useState<Flow>("loading");
  const [session, setSession] = useState<AdminSessionResponse | null>(null);

  useEffect(() => {
    let active = true;
    void adminApi
      .session()
      .then((value) => {
        if (!active) return;
        setSession(value);
        setAdminIdentity(value);
        setFlow("app");
      })
      .catch(() => {
        if (active) setFlow("login");
      });
    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    await adminApi.logout().catch(() => undefined);
    setSession(null);
    setAdminIdentity(null);
    setFlow("login");
  }

  function loginComplete(response: AdminLoginResponse) {
    setSession(response.session);
    setAdminIdentity(response.session);
    setFlow("app");
  }

  if (flow === "loading")
    return (
      <div className="admin-loading-screen">
        <Spin size="large" />
        <span>正在连接管理服务</span>
      </div>
    );
  if (flow === "login") return <LoginScreen onComplete={loginComplete} />;
  return session ? (
    <Console
      session={session}
      onSessionUpdated={(value) => {
        setSession(value);
        setAdminIdentity(value);
      }}
      onLogout={() => void logout()}
    />
  ) : (
    <LoginScreen onComplete={loginComplete} />
  );
}
