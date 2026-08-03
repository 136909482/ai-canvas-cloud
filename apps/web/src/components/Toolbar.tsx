import type { ReactNode } from "react";
import { LogOut, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/features/auth/useAuthStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSettingsDialogStore } from "@/store/useSettingsDialogStore";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { StorageSettingsPanel } from "@/components/StorageSettingsDialog";
import { AccountSettingsPanel } from "@/features/auth/AccountMenu";
import { DeviceSettingsPanel } from "@/features/auth/DeviceSettingsPanel";
import { TaskQueueButton } from "@/components/TaskQueueButton";
import { themeClasses } from "@/styles/themeClasses";
import type { CanvasPerformanceMode, EdgeStyle, ThemeMode } from "@/types";
import {
  AUTOSAVE_INTERVAL_OPTIONS,
  CANVAS_EXPERIENCE_TEXT,
  CANVAS_OPTION_BUTTON_CLASS,
  CANVAS_OPTION_GROUP_CLASS,
  CANVAS_PERFORMANCE_OPTIONS,
  CANVAS_SETTINGS_ROW_CLASS,
  EDGE_STYLE_OPTIONS,
  EXPOSED_SETTINGS_CATEGORIES,
  SETTINGS_CATEGORIES,
  THEME_MODE_OPTIONS,
  UI_TEXT,
  cx,
} from "@/components/toolbar/settingsModel";
import { CanvasSettingsSwitch } from "@/components/toolbar/settingsComponents";
import { LocalVaultSettingsPanel } from "@/features/settings/LocalVaultSettingsPanel";

interface ToolbarProps {
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}

export function Toolbar({ leftSlot, rightSlot }: ToolbarProps) {
  const { config, updateStorageSettings } = useSettingsStore(
    useShallow((state) => ({
      config: state.config,
      updateStorageSettings: state.updateStorageSettings,
    })),
  );
  const logout = useAuthStore((state) => state.logout);
  const showSettings = useSettingsDialogStore((state) => state.isOpen);
  const activeCategory = useSettingsDialogStore(
    (state) => state.activeCategory,
  );
  const closeSettings = useSettingsDialogStore((state) => state.close);
  const setActiveCategory = useSettingsDialogStore(
    (state) => state.setActiveCategory,
  );

  const closeSettingsPanel = () => {
    closeSettings();
  };

  const settingsDialogRef = useDialogFocus<HTMLDivElement>(
    showSettings,
    closeSettingsPanel,
  );
  const handleToggleAlignmentGuides = async () => {
    await updateStorageSettings({
      alignmentGuidesEnabled: !config.storage.alignmentGuidesEnabled,
    }).catch(() => undefined);
  };

  const handleToggleIncomingEdgeAnimation = async () => {
    await updateStorageSettings({
      incomingEdgeAnimationEnabled:
        !config.storage.incomingEdgeAnimationEnabled,
    }).catch(() => undefined);
  };

  const handleToggleCanvasGrid = async () => {
    await updateStorageSettings({
      canvasGridEnabled: !config.storage.canvasGridEnabled,
    }).catch(() => undefined);
  };

  const handleCanvasPerformanceModeChange = async (
    canvasPerformanceMode: CanvasPerformanceMode,
  ) => {
    await updateStorageSettings({ canvasPerformanceMode }).catch(
      () => undefined,
    );
  };

  const handleEdgeStyleChange = async (edgeStyle: EdgeStyle) => {
    await updateStorageSettings({ edgeStyle }).catch(() => undefined);
  };

  const handleToggleHighQualityPreview = async () => {
    await updateStorageSettings({
      lowQualityPreviewEnabled: !config.storage.lowQualityPreviewEnabled,
    }).catch(() => undefined);
  };

  const handleThemeModeChange = async (themeMode: ThemeMode) => {
    await updateStorageSettings({ themeMode }).catch(() => undefined);
  };

  return (
    <>
      {leftSlot ? (
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
          {leftSlot}
        </div>
      ) : null}

      <div
        role="toolbar"
        aria-label="应用工具"
        className={`absolute right-4 top-4 z-10 flex items-center gap-0.5 p-1 ${themeClasses.compactFloatingPanel}`}
      >
        <TaskQueueButton />
        {rightSlot}
      </div>

      {showSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/30 px-4 py-6 backdrop-blur-sm">
          <div
            ref={settingsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            tabIndex={-1}
            className={`flex h-[min(84vh,44rem)] w-[min(94vw,76rem)] flex-col overflow-hidden rounded-[16px] md:grid md:grid-cols-[13rem_minmax(0,1fr)] ${themeClasses.strongPanel}`}
          >
            <aside className="flex shrink-0 flex-col border-b border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] md:min-h-0 md:border-b-0 md:border-r">
              <div className="hidden h-[65px] shrink-0 items-center border-b border-[var(--border-subtle)] px-4 md:flex">
                <h2
                  id="settings-dialog-title"
                  className={`text-[15px] font-semibold ${themeClasses.textPrimary}`}
                >
                  {UI_TEXT.settingsTitle}
                </h2>
              </div>

              <div className="overflow-x-auto px-2 py-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:py-3">
                <div className="flex gap-1 md:block md:space-y-1">
                  {EXPOSED_SETTINGS_CATEGORIES.map((category) => {
                    const active = activeCategory === category.id;
                    const CategoryIcon = category.Icon;

                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveCategory(category.id)}
                        data-testid={`settings-category-${category.id}`}
                        aria-label={category.label}
                        aria-pressed={active}
                        className={cx(
                          "settings-nav-item group relative w-auto shrink-0 overflow-hidden rounded-[10px] border px-3 py-2.5 text-left transition-all duration-200 ease-out md:w-full",
                          active
                            ? "is-active border-violet-400/30 bg-violet-400/10 text-[var(--text-primary)] shadow-[0_8px_24px_rgba(139,92,246,0.08)]"
                            : "border-transparent text-[var(--text-muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]",
                        )}
                      >
                        <span className="flex items-center gap-2 text-[13px] font-medium">
                          <span
                            className={cx(
                              "transition-colors duration-200",
                              active
                                ? "text-violet-300"
                                : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]",
                            )}
                          >
                            <CategoryIcon className="h-3.5 w-3.5" />
                          </span>
                          {category.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="hidden shrink-0 p-2 md:block">
                <button
                  type="button"
                  data-testid="settings-logout-button"
                  onClick={() => {
                    closeSettingsPanel();
                    void logout();
                  }}
                  className="group flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:bg-red-500/8 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400/50 dark:hover:text-red-300"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-red-500 dark:group-hover:text-red-300" />
                  <span>退出登录</span>
                </button>
              </div>
            </aside>

            <main className="min-h-0 flex-1 bg-[var(--panel-bg-strong)]">
              {activeCategory === "models" ? (
                <section
                  key="local-vault"
                  className="settings-content-enter flex h-full min-h-0 flex-col"
                >
                  <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
                    <h2
                      className={`text-[15px] font-semibold ${themeClasses.textPrimary}`}
                    >
                      {
                        SETTINGS_CATEGORIES.find(
                          (category) => category.id === activeCategory,
                        )?.label
                      }
                    </h2>
                    <button
                      type="button"
                      onClick={closeSettingsPanel}
                      aria-label={UI_TEXT.close}
                      className={`${themeClasses.iconButton} h-8 w-8 shrink-0 rounded-[9px]`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </header>
                  <div className="min-h-0 flex-1">
                    <LocalVaultSettingsPanel />
                  </div>
                </section>
              ) : (
                <section
                  key={activeCategory}
                  className="settings-content-enter flex h-full min-h-0 flex-col"
                >
                  <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
                    <div className="min-w-0">
                      <h2
                        className={`text-[15px] font-semibold ${themeClasses.textPrimary}`}
                      >
                        {
                          SETTINGS_CATEGORIES.find(
                            (category) => category.id === activeCategory,
                          )?.label
                        }
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={closeSettingsPanel}
                      aria-label={UI_TEXT.close}
                      className={`${themeClasses.iconButton} h-8 w-8 shrink-0 rounded-[9px]`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </header>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-subtle)] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
                    {activeCategory === "account" ? (
                      <AccountSettingsPanel />
                    ) : null}
                    {activeCategory === "devices" ? (
                      <DeviceSettingsPanel />
                    ) : null}
                    {activeCategory === "storage" ? (
                      <StorageSettingsPanel
                        active={showSettings && activeCategory === "storage"}
                      />
                    ) : null}
                    {activeCategory === "canvas" ? (
                      <section className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.performanceMode}
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.performanceModeHint}
                            </p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {CANVAS_PERFORMANCE_OPTIONS.map((option) => {
                              const active =
                                config.storage.canvasPerformanceMode ===
                                option.id;

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    void handleCanvasPerformanceModeChange(
                                      option.id,
                                    );
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]"
                                      : "text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]",
                                  )}
                                  aria-pressed={active}
                                >
                                  <span className="block truncate">
                                    {option.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.lowQualityPreview}
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.lowQualityPreviewHint}
                            </p>
                          </div>
                          <CanvasSettingsSwitch
                            checked={config.storage.lowQualityPreviewEnabled}
                            label="启用高清图片预览"
                            onChange={() => {
                              void handleToggleHighQualityPreview();
                            }}
                          />
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.alignmentGuides}
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.alignmentGuidesHint}
                            </p>
                          </div>
                          <CanvasSettingsSwitch
                            checked={config.storage.alignmentGuidesEnabled}
                            label="启用对齐参考线"
                            onChange={() => {
                              void handleToggleAlignmentGuides();
                            }}
                          />
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.incomingEdgeAnimation}
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.incomingEdgeAnimationHint}
                            </p>
                          </div>
                          <CanvasSettingsSwitch
                            checked={
                              config.storage.incomingEdgeAnimationEnabled
                            }
                            label="选中节点时突出显示上游连线"
                            onChange={() => {
                              void handleToggleIncomingEdgeAnimation();
                            }}
                          />
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              画布自动保存时间
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              自动保存会直接写入当前项目文件，但不会替代手动保存。
                            </p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {AUTOSAVE_INTERVAL_OPTIONS.map((option) => {
                              const active =
                                option.value ===
                                config.storage.autosaveIntervalMs;

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => {
                                    void updateStorageSettings({
                                      autosaveIntervalMs: option.value,
                                    }).catch(() => undefined);
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]"
                                      : "text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]",
                                  )}
                                  aria-pressed={active}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </section>
                    ) : null}
                    {activeCategory === "appearance" ? (
                      <section className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.appearanceTheme}
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.appearanceThemeHint}
                            </p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {THEME_MODE_OPTIONS.map((option) => {
                              const active =
                                config.storage.themeMode === option.id;

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    void handleThemeModeChange(option.id);
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]"
                                      : "text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]",
                                  )}
                                  aria-pressed={active}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.canvasGrid}
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.canvasGridHint}
                            </p>
                          </div>
                          <CanvasSettingsSwitch
                            checked={config.storage.canvasGridEnabled}
                            label="显示画布网格"
                            onChange={() => {
                              void handleToggleCanvasGrid();
                            }}
                          />
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.edgeStyle}
                            </div>
                            <p
                              className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}
                            >
                              {CANVAS_EXPERIENCE_TEXT.edgeStyleHint}
                            </p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {EDGE_STYLE_OPTIONS.map((option) => {
                              const active =
                                config.storage.edgeStyle === option.id;

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    void handleEdgeStyleChange(option.id);
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]"
                                      : "text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]",
                                  )}
                                  aria-pressed={active}
                                >
                                  <span className="block truncate">
                                    {option.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </section>
                    ) : null}
                  </div>
                </section>
              )}
            </main>
          </div>
        </div>
      )}
    </>
  );
}
