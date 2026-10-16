import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  GENERATE_OUTPUT_COUNTS,
  GPT_IMAGE_BACKGROUNDS,
} from "@/constants/generateNode";
import {
  RatioPreview,
  SettingsSection,
  SettingsSegment,
} from "@/nodes/GenerateNode/modelOptions";
import {
  GPT_IMAGE_QUALITIES,
  GPT_IMAGE_BACKGROUND_LABELS,
  GPT_IMAGE_QUALITY_LABELS,
  RATIOS,
  RESOLUTIONS,
  getRatioLabel,
  getResolutionLabel,
} from "@/nodes/GenerateNode/modelSettings";
import { themeClasses } from "@/styles/themeClasses";
import type { GenerateNodeController } from "./useGenerateNodeController";

type SettingsController = Pick<
  GenerateNodeController,
  | "ratio"
  | "resolution"
  | "quality"
  | "outputCount"
  | "background"
  | "showBackgroundSettings"
  | "settingsSummary"
  | "showResolutionSettings"
  | "isGptImageSettingsModel"
  | "updateGenerationSettings"
>;

export function GenerationSettingsMenu({
  controller,
}: {
  controller: SettingsController;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus({ preventScroll: true });
    });
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative w-56 max-w-full shrink-0"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="生成参数：比例、清晰度、画质、背景和张数"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        title={controller.settingsSummary}
        onClick={() => setOpen((current) => !current)}
        className={`nodrag nopan flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent px-3 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-violet-muted)] ${open ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]" : "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"}`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[var(--accent-violet-strong)]" />
        <span className="min-w-0 flex-1 truncate">
          {controller.settingsSummary}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="图片生成参数"
          className={`node-menu-scrollbar nodrag nopan nowheel absolute bottom-full left-0 z-50 mb-2 max-h-[min(520px,calc(100dvh-2rem))] w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-3 ${themeClasses.strongPanel}`}
        >
          <div className="space-y-3">
            <SettingsSection title="比例">
              <SettingsSegment
                value={controller.ratio}
                options={RATIOS}
                ariaLabel="选择画幅"
                onChange={(ratio) =>
                  controller.updateGenerationSettings({ ratio })
                }
                groupClassName="!h-auto !grid-flow-row grid-cols-6 !auto-cols-auto gap-x-1 gap-y-2 rounded-[9px] border-[color-mix(in_srgb,var(--text-primary)_11%,transparent)] bg-[var(--control-bg)] p-2 shadow-none"
                buttonClassName="h-12 flex-col gap-1 rounded-[7px] px-1.5 py-1.5 text-[10px] leading-none hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]"
                gridSlider={{
                  columns: 6,
                  rowHeightRem: 3,
                  columnGapRem: 0.25,
                  rowGapRem: 0.5,
                  insetRem: 0.5,
                }}
                renderOption={(ratio) => (
                  <>
                    <RatioPreview ratio={ratio} />
                    {getRatioLabel(ratio)}
                  </>
                )}
              />
            </SettingsSection>
            {controller.showResolutionSettings ? (
              <SettingsSection title="清晰度">
                <SettingsSegment
                  value={controller.resolution}
                  options={RESOLUTIONS}
                  ariaLabel="选择分辨率"
                  onChange={(resolution) =>
                    controller.updateGenerationSettings({ resolution })
                  }
                  groupClassName="h-10 rounded-[9px] border-[color-mix(in_srgb,var(--text-primary)_11%,transparent)] bg-[var(--control-bg)] p-1 shadow-none"
                  buttonClassName="rounded-[7px] text-[11px] hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
                  slider
                  renderOption={getResolutionLabel}
                />
              </SettingsSection>
            ) : null}
            {controller.isGptImageSettingsModel ? (
              <SettingsSection title="画质">
                <SettingsSegment
                  value={controller.quality}
                  options={GPT_IMAGE_QUALITIES}
                  ariaLabel="选择 GPT Image 画质"
                  onChange={(quality) =>
                    controller.updateGenerationSettings({ quality })
                  }
                  groupClassName="h-10 rounded-[9px] border-[color-mix(in_srgb,var(--text-primary)_11%,transparent)] bg-[var(--control-bg)] p-1 shadow-none"
                  buttonClassName="rounded-[7px] text-[11px] hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
                  slider
                  renderOption={(quality) => GPT_IMAGE_QUALITY_LABELS[quality]}
                />
              </SettingsSection>
            ) : null}
            {controller.showBackgroundSettings ? (
              <SettingsSection title="背景">
                <SettingsSegment
                  value={controller.background}
                  options={GPT_IMAGE_BACKGROUNDS}
                  ariaLabel="选择图片背景"
                  onChange={(background) =>
                    controller.updateGenerationSettings({ background })
                  }
                  groupClassName="h-10 rounded-[9px] border-[color-mix(in_srgb,var(--text-primary)_11%,transparent)] bg-[var(--control-bg)] p-1 shadow-none"
                  buttonClassName="rounded-[7px] text-[11px] hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
                  slider
                  renderOption={(background) =>
                    GPT_IMAGE_BACKGROUND_LABELS[background]
                  }
                />
              </SettingsSection>
            ) : null}
            <SettingsSection title="张数">
              <SettingsSegment
                value={controller.outputCount}
                options={GENERATE_OUTPUT_COUNTS}
                ariaLabel="选择生成张数"
                onChange={(outputCount) =>
                  controller.updateGenerationSettings({ outputCount })
                }
                groupClassName="h-10 rounded-[9px] border-[color-mix(in_srgb,var(--text-primary)_11%,transparent)] bg-[var(--control-bg)] p-1 shadow-none"
                buttonClassName="rounded-[7px] text-[11px] hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
                slider
                renderOption={(outputCount) => `${outputCount} 张`}
              />
            </SettingsSection>
          </div>
        </div>
      ) : null}
    </div>
  );
}
