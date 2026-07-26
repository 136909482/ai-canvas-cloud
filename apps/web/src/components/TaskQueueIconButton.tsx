import type { ReactNode } from "react";
import { TooltipIconButton } from "@/components/TooltipIconButton";
import { themeClasses } from "@/styles/themeClasses";

type TaskQueueIconButtonProps = {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  className?: string;
  testId?: string;
  tooltipPlacement?: "top" | "bottom";
  showTooltip?: boolean;
  expanded?: boolean;
  controls?: string;
  hasPopup?: "dialog";
};

export function TaskQueueIconButton({
  label,
  onClick,
  icon,
  className,
  testId,
  tooltipPlacement = "top",
  showTooltip = true,
  expanded,
  controls,
  hasPopup,
}: TaskQueueIconButtonProps) {
  return (
    <TooltipIconButton
      label={label}
      onClick={onClick}
      testId={testId}
      showTooltip={showTooltip}
      tooltipPlacement={tooltipPlacement}
      tooltipAlign="center"
      className={`${themeClasses.iconButton} h-6 w-6 rounded-md ${className ?? ""}`}
      expanded={expanded}
      controls={controls}
      hasPopup={hasPopup}
      icon={icon}
    />
  );
}
