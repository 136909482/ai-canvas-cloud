import { theme, type ThemeConfig } from "antd";

export const adminTheme: ThemeConfig = {
  algorithm: [theme.defaultAlgorithm, theme.compactAlgorithm],
  token: {
    colorPrimary: "#2563eb",
    colorInfo: "#2563eb",
    colorSuccess: "#16855b",
    colorWarning: "#b76e00",
    colorError: "#c93b3b",
    colorText: "#18202f",
    colorTextSecondary: "#657084",
    colorBorder: "#e1e6ee",
    colorBorderSecondary: "#edf0f4",
    colorBgLayout: "#f5f7fa",
    colorBgContainer: "#ffffff",
    colorFillAlter: "#f7f9fc",
    borderRadius: 8,
    borderRadiusLG: 8,
    borderRadiusSM: 6,
    controlHeight: 36,
    controlHeightSM: 32,
    fontSize: 14,
    fontFamily:
      'Inter, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
    boxShadowSecondary: "0 12px 34px rgba(24, 32, 47, 0.12)",
  },
  components: {
    Button: {
      borderRadius: 7,
      controlHeight: 36,
      controlHeightSM: 32,
      fontWeight: 500,
    },
    Card: {
      borderRadiusLG: 8,
      boxShadowTertiary: "0 1px 2px rgba(24, 32, 47, 0.04)",
    },
    Descriptions: {
      labelBg: "#f7f9fc",
    },
    Drawer: {
      paddingLG: 20,
    },
    Form: {
      itemMarginBottom: 18,
      labelColor: "#475569",
      labelFontSize: 13,
    },
    Input: {
      activeShadow: "0 0 0 3px rgba(37, 99, 235, 0.12)",
    },
    Menu: {
      itemHeight: 40,
      itemBorderRadius: 7,
      itemMarginInline: 8,
      itemMarginBlock: 3,
      itemSelectedBg: "#eaf1ff",
      itemSelectedColor: "#1d4ed8",
    },
    Modal: {
      borderRadiusLG: 8,
    },
    Table: {
      headerBg: "#f7f9fc",
      headerColor: "#475569",
      headerBorderRadius: 0,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      rowHoverBg: "#f8faff",
    },
    Tabs: {
      horizontalItemPadding: "10px 4px",
      horizontalItemGutter: 28,
    },
  },
};
