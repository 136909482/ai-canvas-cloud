import "@ant-design/v5-patch-for-react-19";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Refine } from "@refinedev/core";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AdminApp } from "./App";
import {
  adminAccessControlProvider,
  adminAuthProvider,
  adminDataProvider,
} from "./refine";
import { adminTheme } from "./theme";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={adminTheme}>
      <AntApp>
        <Refine
          dataProvider={adminDataProvider}
          authProvider={adminAuthProvider}
          accessControlProvider={adminAccessControlProvider}
          resources={[
            { name: "dashboard", list: "/dashboard" },
            { name: "audit-events", list: "/audit-events" },
            { name: "users", list: "/users" },
            { name: "site-config", list: "/site-config" },
          ]}
          options={{
            reactQuery: {
              clientConfig: { defaultOptions: { queries: { retry: false } } },
            },
          }}
        >
          <AdminApp />
        </Refine>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
