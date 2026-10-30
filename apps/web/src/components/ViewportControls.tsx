import { MenuSurface } from "@/components/MenuSurface";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, useReactFlow, useViewport } from "@xyflow/react";
import {
  AlignHorizontalJustifyCenter,
  Grid3X3,
  Keyboard,
  Moon,
  Redo2,
  Sun,
  Undo2,
} from "lucide-react";
import { TooltipIconButton } from "@/components/TooltipIconButton";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { themeClasses } from "@/styles/themeClasses";
import { handleMenuKeyboard } from "@/utils/menuKeyboard";

const ZOOM_PRESETS = [2, 1, 0.5, 0.2];

const CONTROL_TEXT_STYLE = {
  fontSize: "9px",
  lineHeight: "2.8",
  letterSpacing: "0",
} as const;

const FLOATING_SURFACE_CLASS = themeClasses.floatingPanel;
const COMPACT_FLOATING_SURFACE_CLASS = `${FLOATING_SURFACE_CLASS} p-[4px]`;
const ICON_BUTTON_CLASS = `${themeClasses.iconButton} h-6 w-6`;
const ACTIVE_ICON_BUTTON_CLASS = themeClasses.iconButtonActive;
const DIVIDER_CLASS = `mx-0.5 h-3 w-px ${themeClasses.divider}`;

type ShortcutItem = {
  keyLabel: string;
  name: string;
};

const SHORTCUT_ITEMS: ShortcutItem[] = [
  {
    keyLabel: "Ctrl/Cmd + Z",
    name: "撤销",
  },
  {
    keyLabel: "Ctrl/Cmd + Shift + Z",
    name: "重做",
  },
  {
    keyLabel: "Ctrl/Cmd + C",
    name: "复制节点",
  },
  {
    keyLabel: "Ctrl/Cmd + V",
    name: "粘贴节点",
  },
  {
    keyLabel: "Ctrl/Cmd + D",
    name: "快速复制",
  },
  {
    keyLabel: "C",
    name: "整理关联节点",
  },
];

function formatZoomLabel(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

interface ViewportControlsProps {
  onBeforeHistoryAction?: () => void;
}

export function ViewportControls({
  onBeforeHistoryAction,
}: ViewportControlsProps) {
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [showShortcutMenu, setShowShortcutMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomTriggerRef = useRef<HTMLButtonElement | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const { zoom } = useViewport();
  const { zoomTo, fitView } = useReactFlow();
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const canUndo = useHistoryStore((state) => state.canUndo());
  const canRedo = useHistoryStore((state) => state.canRedo());
  const themeMode = useSettingsStore((state) => state.config.storage.themeMode);
  const canvasGridEnabled = useSettingsStore(
    (state) => state.config.storage.canvasGridEnabled,
  );
  const alignmentGuidesEnabled = useSettingsStore(
    (state) => state.config.storage.alignmentGuidesEnabled,
  );
  const updateStorageSettings = useSettingsStore(
    (state) => state.updateStorageSettings,
  );
  const currentZoomLabel = useMemo(() => formatZoomLabel(zoom), [zoom]);

  useEffect(() => {
    if (!showZoomMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) {
        return;
      }

      setShowZoomMenu(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showZoomMenu]);

  useEffect(() => {
    if (showZoomMenu)
      window.requestAnimationFrame(() =>
        zoomMenuRef.current
          ?.querySelector<HTMLElement>('[role="menuitem"]')
          ?.focus({ preventScroll: true }),
      );
  }, [showZoomMenu]);

  const closeZoomMenu = () => {
    setShowZoomMenu(false);
    window.requestAnimationFrame(() =>
      zoomTriggerRef.current?.focus({ preventScroll: true }),
    );
  };

  const handleZoomPreset = async (nextZoom: number) => {
    await zoomTo(nextZoom, { duration: 180 });
    setShowZoomMenu(false);
  };

  return (
    <Panel position="bottom-left" className="!m-3">
      <div
        ref={containerRef}
        role="toolbar"
        aria-label="画布视图与历史操作"
        className={`flex items-center gap-0 ${COMPACT_FLOATING_SURFACE_CLASS}`}
      >
        <div className="relative">
          <MenuSurface
            open={showZoomMenu}
            id="zoom-menu"
            ref={zoomMenuRef}
            role="menu"
            aria-label="画布缩放"
            onKeyDown={(event) =>
              handleMenuKeyboard(
                event.nativeEvent,
                zoomMenuRef.current,
                closeZoomMenu,
              )
            }
            className={`absolute bottom-[calc(100%+8px)] left-0 w-[92px] ${COMPACT_FLOATING_SURFACE_CLASS}`}
          >
            <div className="flex flex-col gap-0.5">
              {ZOOM_PRESETS.map((preset) => {
                const active = Math.abs(zoom - preset) < 0.01;

                return (
                  <button
                    key={preset}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleZoomPreset(preset);
                    }}
                    className={`flex h-5.5 w-full items-center justify-center rounded-lg border font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] ${
                      active
                        ? themeClasses.iconButtonActive
                        : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span style={CONTROL_TEXT_STYLE}>
                      {formatZoomLabel(preset)}
                    </span>
                  </button>
                );
              })}
            </div>
          </MenuSurface>

          <button
            ref={zoomTriggerRef}
            type="button"
            onClick={() => {
              setShowShortcutMenu(false);
              setShowZoomMenu((current) => !current);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setShowZoomMenu(false);
              setShowShortcutMenu(false);
              void fitView({ padding: 0.2, maxZoom: 0.8, duration: 220 });
            }}
            className={`inline-flex h-6 min-w-[38px] items-center justify-center rounded-lg border px-2 text-[var(--text-secondary)] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] ${
              showZoomMenu
                ? ACTIVE_ICON_BUTTON_CLASS
                : "border-transparent bg-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            }`}
            aria-label="打开缩放菜单"
            aria-haspopup="menu"
            aria-expanded={showZoomMenu}
            aria-controls={showZoomMenu ? "zoom-menu" : undefined}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setShowShortcutMenu(false);
                setShowZoomMenu(true);
              }
            }}
            title="单击选择缩放比例，双击适应画布"
          >
            <span style={CONTROL_TEXT_STYLE}>{currentZoomLabel}</span>
          </button>
        </div>

        <span className={DIVIDER_CLASS} aria-hidden="true" />

        <div
          className="relative"
          onPointerEnter={() => {
            setShowZoomMenu(false);
            setShowShortcutMenu(true);
          }}
          onPointerLeave={() => setShowShortcutMenu(false)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setShowShortcutMenu(false);
          }}
        >
          <MenuSurface
            open={showShortcutMenu}
            id="shortcut-help"
            role="dialog"
            aria-label="快捷键说明"
            className={`absolute bottom-[calc(100%+8px)] left-0 w-[210px] max-w-[calc(100vw-24px)] p-3.5 ${FLOATING_SURFACE_CLASS}`}
          >
            <div className="pb-3 text-[10px] font-semibold text-[var(--text-muted)]">
              快捷键
            </div>

            <div className="flex flex-col gap-3">
              {SHORTCUT_ITEMS.map((item) => (
                <div
                  key={item.name}
                  className="flex min-h-4 items-center justify-between gap-3"
                >
                  <span className="min-w-0 text-[11px] font-medium tracking-normal text-[var(--text-primary)]">
                    {item.name}
                  </span>
                  <span className={themeClasses.shortcutKey}>
                    {item.keyLabel}
                  </span>
                </div>
              ))}
            </div>
          </MenuSurface>

          <button
            type="button"
            onClick={() => {
              setShowZoomMenu(false);
              setShowShortcutMenu((current) => !current);
            }}
            onFocus={() => {
              setShowZoomMenu(false);
              setShowShortcutMenu(true);
            }}
            className={`${ICON_BUTTON_CLASS} ${
              showShortcutMenu ? ACTIVE_ICON_BUTTON_CLASS : ""
            }`}
            aria-label="查看快捷键说明"
            aria-haspopup="dialog"
            aria-expanded={showShortcutMenu}
            aria-controls={showShortcutMenu ? "shortcut-help" : undefined}
          >
            <Keyboard className="h-3 w-3" />
          </button>
        </div>

        <TooltipIconButton
          label="撤销"
          onClick={() => {
            onBeforeHistoryAction?.();
            undo();
          }}
          disabled={!canUndo}
          testId="undo-button"
          tooltipPlacement="top"
          tooltipAlign="start"
          className={ICON_BUTTON_CLASS}
          icon={<Undo2 className="h-3 w-3" />}
        />
        <TooltipIconButton
          label="重做"
          onClick={() => {
            onBeforeHistoryAction?.();
            redo();
          }}
          disabled={!canRedo}
          testId="redo-button"
          tooltipPlacement="top"
          tooltipAlign="start"
          className={ICON_BUTTON_CLASS}
          icon={<Redo2 className="h-3 w-3" />}
        />

        <TooltipIconButton
          label={themeMode === "light" ? "切换到暗色主题" : "切换到浅色主题"}
          onClick={() => {
            setShowZoomMenu(false);
            setShowShortcutMenu(false);
            void updateStorageSettings({
              themeMode: themeMode === "light" ? "dark" : "light",
            }).catch(() => undefined);
          }}
          testId="toggle-theme-button"
          tooltipPlacement="top"
          className={ICON_BUTTON_CLASS}
          icon={
            themeMode === "light" ? (
              <Moon className="h-3 w-3" />
            ) : (
              <Sun className="h-3 w-3" />
            )
          }
        />
        <TooltipIconButton
          label={canvasGridEnabled ? "隐藏画布网格" : "显示画布网格"}
          onClick={() => {
            setShowZoomMenu(false);
            setShowShortcutMenu(false);
            void updateStorageSettings({
              canvasGridEnabled: !canvasGridEnabled,
            }).catch(() => undefined);
          }}
          pressed={canvasGridEnabled}
          testId="toggle-canvas-grid-button"
          tooltipPlacement="top"
          className={`${ICON_BUTTON_CLASS} ${canvasGridEnabled ? ACTIVE_ICON_BUTTON_CLASS : ""}`}
          icon={<Grid3X3 className="h-3 w-3" />}
        />
        <TooltipIconButton
          label={alignmentGuidesEnabled ? "关闭对齐参考线" : "开启对齐参考线"}
          onClick={() => {
            setShowZoomMenu(false);
            setShowShortcutMenu(false);
            void updateStorageSettings({
              alignmentGuidesEnabled: !alignmentGuidesEnabled,
            }).catch(() => undefined);
          }}
          pressed={alignmentGuidesEnabled}
          testId="toggle-alignment-guides-button"
          tooltipPlacement="top"
          className={`${ICON_BUTTON_CLASS} ${alignmentGuidesEnabled ? ACTIVE_ICON_BUTTON_CLASS : ""}`}
          icon={<AlignHorizontalJustifyCenter className="h-3 w-3" />}
        />
      </div>
    </Panel>
  );
}
