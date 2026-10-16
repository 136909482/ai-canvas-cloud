import { useId, useState, type ReactNode } from "react";
import { AtSign, X } from "lucide-react";
import { CanvasImagePreview } from "@/components/CanvasImagePreview";
import {
  buildReferenceImageAsset,
  type ReferenceImageItem,
} from "@/nodes/GenerateNode/referenceImages";

export function GenerationReferenceCard({
  label,
  badge,
  children,
  preview,
  onDisconnect,
  disconnectLabel,
  disconnectTestId,
  onMention,
  hideBadgeOnHover = false,
  isMask = false,
  testId,
}: {
  label: string;
  badge: string;
  children: ReactNode;
  preview: ReactNode;
  onDisconnect: () => void;
  disconnectLabel: string;
  disconnectTestId?: string;
  onMention?: () => void;
  hideBadgeOnHover?: boolean;
  isMask?: boolean;
  testId?: string;
}) {
  const previewId = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const actionClassName =
    "absolute z-20 flex h-4 w-4 items-center justify-center rounded-full border border-white/50 bg-zinc-800/90 text-white opacity-0 outline-none transition-opacity duration-150 pointer-events-none group-hover/reference:pointer-events-auto group-hover/reference:opacity-100 group-focus-within/reference:pointer-events-auto group-focus-within/reference:opacity-100 hover:bg-zinc-600 focus-visible:ring-2 focus-visible:ring-[var(--accent-violet)] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100";

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={label}
      aria-describedby={previewOpen ? previewId : undefined}
      data-testid={testId}
      className="group/reference relative h-12 w-12 shrink-0 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-violet)]"
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setPreviewOpen(true);
      }}
      onPointerLeave={() => setPreviewOpen(false)}
      onFocus={() => setPreviewOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPreviewOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && previewOpen) {
          event.stopPropagation();
          setPreviewOpen(false);
        }
      }}
    >
      <div
        className={`flex h-full w-full items-center justify-center overflow-hidden rounded-lg border bg-[var(--control-bg-hover)] text-[var(--text-secondary)] transition-colors ${isMask ? "border-amber-400/50" : "border-[var(--border-subtle)] group-hover/reference:border-[var(--border-default)]"}`}
      >
        {children}
      </div>
      <span
        className={`pointer-events-none absolute left-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-black/65 px-0.5 text-[9px] leading-none text-white ${hideBadgeOnHover ? "transition-opacity duration-150 group-hover/reference:opacity-0" : ""}`}
      >
        {badge}
      </span>
      <button
        type="button"
        aria-label={disconnectLabel}
        title={disconnectLabel}
        data-testid={disconnectTestId}
        onClick={onDisconnect}
        className={`${actionClassName} -right-0.5 -top-0.5`}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
      {onMention ? (
        <button
          type="button"
          aria-label={`在提示词中引用${label}`}
          title="插入图片引用"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onMention}
          className={`${actionClassName} -bottom-0.5 -right-0.5`}
        >
          <AtSign className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
      {previewOpen ? (
        <div className="absolute bottom-full left-0 z-30 pb-2">
          <div id={previewId} role="tooltip">
            {preview}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ImageReferenceCard({
  image,
  order,
  onDisconnect,
  disconnectTestId,
  onMention,
  isMask = false,
}: {
  image: ReferenceImageItem;
  order?: number;
  onDisconnect: () => void;
  disconnectTestId?: string;
  onMention?: () => void;
  isMask?: boolean;
}) {
  const label = isMask ? "蒙版" : `图片${order}`;
  const imageAsset = buildReferenceImageAsset(image);
  return (
    <GenerationReferenceCard
      label={label}
      badge={isMask ? "蒙" : String(order)}
      disconnectLabel={isMask ? "移除蒙版输入" : `移除第 ${order} 张参考图`}
      disconnectTestId={disconnectTestId}
      onDisconnect={onDisconnect}
      onMention={onMention}
      hideBadgeOnHover={!isMask}
      isMask={isMask}
      preview={
        <div className="w-44 max-w-[calc(100vw-3rem)] rounded-xl border border-[var(--floating-panel-border)] bg-[var(--panel-bg-strong)] p-1 shadow-lg">
          <CanvasImagePreview
            src={image.imageUrl}
            imageAsset={imageAsset}
            alt={`${label}预览`}
            className="h-24 w-full rounded-lg object-contain"
          />
        </div>
      }
    >
      <CanvasImagePreview
        src={image.imageUrl}
        imageAsset={imageAsset}
        alt={label}
        className="h-full w-full object-cover"
        forceLowQualityPreview
      />
    </GenerationReferenceCard>
  );
}
