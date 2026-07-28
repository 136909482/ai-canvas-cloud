import type { MouseEvent, ReactNode } from "react";

type TooltipPlacement = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

type TooltipIconButtonProps = {
  label: string;
  icon: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  testId?: string;
  disabled?: boolean;
  showTooltip?: boolean;
  tooltipPlacement?: TooltipPlacement;
  tooltipAlign?: TooltipAlign;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  hasPopup?: "menu" | "listbox" | "dialog";
};

export function TooltipIconButton({
  label,
  icon,
  onClick,
  className,
  testId,
  disabled = false,
  showTooltip = true,
  tooltipPlacement = "bottom",
  tooltipAlign = "center",
  pressed,
  expanded,
  controls,
  hasPopup,
}: TooltipIconButtonProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-haspopup={hasPopup}
        aria-describedby={showTooltip ? "app-tooltip" : undefined}
        data-tooltip={showTooltip ? label : undefined}
        data-tooltip-placement={tooltipPlacement}
        data-tooltip-align={tooltipAlign}
        data-testid={testId}
        disabled={disabled}
        className={`inline-flex items-center justify-center rounded-lg border border-transparent bg-transparent transition ${className ?? ""}`}
      >
        {icon}
      </button>
    </div>
  );
}
