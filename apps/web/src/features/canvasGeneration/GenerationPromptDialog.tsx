import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";

export function GenerationPromptDialog({
  children,
  onClose,
  ariaLabel = "图片生成面板，放大编辑",
  initialFocusSelector = '[contenteditable="true"]',
}: {
  children: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  initialFocusSelector?: string;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(
    true,
    onClose,
    initialFocusSelector,
  );

  return createPortal(
    <div
      className="nodrag nopan nowheel fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-3 sm:p-8"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Let the dialog focus helper handle Tab/Escape; contain canvas shortcuts.
        if (event.key !== "Tab" && event.key !== "Escape")
          event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        data-testid="generation-prompt-dialog"
        className="h-[calc(100dvh-24px)] w-full sm:h-[min(720px,calc(100dvh-80px))] sm:w-[min(960px,calc(100vw-64px))]"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
