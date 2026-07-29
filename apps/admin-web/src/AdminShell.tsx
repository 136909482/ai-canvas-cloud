import { useMemo, useState, type ReactNode } from "react";
import type { AdminSessionResponse } from "@ai-canvas-cloud/contracts";
import { Button, Drawer, Layout, Menu, Tooltip, type MenuProps } from "antd";
import {
  Activity,
  HardDrive,
  LogOut,
  Mail,
  Menu as MenuIcon,
  ScrollText,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Brand } from "./components";
import { navigationForRole, type AdminView } from "./navigation";
import { ROLE_LABELS } from "./uiModel";

const ICONS: Record<AdminView, ReactNode> = {
  dashboard: <Activity size={18} />,
  users: <UsersRound size={18} />,
  site: <SlidersHorizontal size={18} />,
  smtp: <Mail size={18} />,
  storage: <HardDrive size={18} />,
  audit: <ScrollText size={18} />,
  security: <ShieldCheck size={18} />,
};

export function AdminShell({
  session,
  view,
  onNavigate,
  onLogout,
  children,
}: {
  session: AdminSessionResponse;
  view: AdminView;
  onNavigate: (view: AdminView) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>([]);
  const navigation = useMemo(
    () => navigationForRole(session.admin.role),
    [session.admin.role],
  );
  const menuItems = useMemo<MenuProps["items"]>(() => {
    const settingsViews = new Set<AdminView>(["site", "storage", "smtp"]);
    const settingsItems = navigation
      .filter((item) => settingsViews.has(item.key))
      .map((item) => ({
        key: item.key,
        icon: ICONS[item.key],
        label: item.key === "site" ? "基础设置" : item.label,
      }));
    const items: NonNullable<MenuProps["items"]> = [];

    for (const item of navigation) {
      if (item.key === "site") {
        items.push({
          key: "site-settings",
          icon: <Settings2 size={18} />,
          label: "网站设置",
          children: settingsItems,
        });
        continue;
      }
      if (settingsViews.has(item.key)) continue;
      items.push({
        key: item.key,
        icon: ICONS[item.key],
        label: item.label,
      });
    }

    return items;
  }, [navigation]);

  function navigate(key: string) {
    onNavigate(key as AdminView);
    if (["site", "storage", "smtp"].includes(key)) {
      setOpenMenuKeys(["site-settings"]);
    }
    setDrawerOpen(false);
  }

  const navigationMenu = (
    <Menu
      mode="inline"
      selectedKeys={[view]}
      openKeys={openMenuKeys}
      items={menuItems}
      onClick={({ key }) => navigate(key)}
      onOpenChange={setOpenMenuKeys}
      aria-label="后台主导航"
    />
  );
  const administrator = (
    <div className="admin-identity">
      <span className="admin-identity__icon">
        <UserRound size={17} />
      </span>
      <div>
        <strong>{session.admin.username}</strong>
        <span>{ROLE_LABELS[session.admin.role]}</span>
      </div>
      <Tooltip title="退出登录">
        <Button
          type="text"
          icon={<LogOut size={17} />}
          onClick={onLogout}
          aria-label="退出登录"
        />
      </Tooltip>
    </div>
  );

  return (
    <Layout className="admin-shell">
      <Layout.Sider width={216} theme="light" className="admin-sider">
        <div className="admin-sider__inner">
          <Brand />
          <nav className="admin-navigation">{navigationMenu}</nav>
          {administrator}
        </div>
      </Layout.Sider>
      <Layout className="admin-main-layout">
        <header className="admin-mobile-header">
          <Brand compact />
          <Button
            type="text"
            icon={<MenuIcon size={20} />}
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
          />
        </header>
        <Layout.Content className="admin-content">{children}</Layout.Content>
      </Layout>
      <Drawer
        className="admin-mobile-drawer"
        placement="left"
        width={280}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={<Brand compact />}
      >
        <div className="admin-drawer__body">
          <nav className="admin-navigation">{navigationMenu}</nav>
          {administrator}
        </div>
      </Drawer>
    </Layout>
  );
}
