import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { themeClasses } from "@/styles/themeClasses";

type TooltipPlacement = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

type ActiveTooltip = {
  target: HTMLElement;
  content: string;
  placement: TooltipPlacement;
  align: TooltipAlign;
};

type TooltipPosition = {
  left: number;
  top: number;
};

const TOOLTIP_SELECTOR = "[data-tooltip], [title]";
const TOOLTIP_SHOW_DELAY_MS = 400;
const TOOLTIP_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

function getTooltipTarget(value: EventTarget | null) {
  return value instanceof Element
    ? value.closest<HTMLElement>(TOOLTIP_SELECTOR)
    : null;
}

function getTooltipDescriptor(target: HTMLElement): ActiveTooltip | null {
  const nativeTitle = target.getAttribute("title")?.trim();
  if (nativeTitle) {
    target.dataset.tooltip = nativeTitle;
    target.removeAttribute("title");
  }

  const content = target.dataset.tooltip?.trim();
  if (!content) return null;

  const requestedPlacement = target.dataset.tooltipPlacement;
  const requestedAlign = target.dataset.tooltipAlign;

  return {
    target,
    content,
    placement:
      requestedPlacement === "right" ||
      requestedPlacement === "bottom" ||
      requestedPlacement === "left"
        ? requestedPlacement
        : "top",
    align:
      requestedAlign === "start" || requestedAlign === "end"
        ? requestedAlign
        : "center",
  };
}

function flipPlacement(
  placement: TooltipPlacement,
  target: DOMRect,
  tooltip: DOMRect,
) {
  if (
    placement === "top" &&
    target.top - tooltip.height - TOOLTIP_GAP_PX < VIEWPORT_MARGIN_PX
  ) {
    return "bottom";
  }

  if (
    placement === "bottom" &&
    target.bottom + tooltip.height + TOOLTIP_GAP_PX >
      window.innerHeight - VIEWPORT_MARGIN_PX
  ) {
    return "top";
  }

  if (
    placement === "left" &&
    target.left - tooltip.width - TOOLTIP_GAP_PX < VIEWPORT_MARGIN_PX
  ) {
    return "right";
  }

  if (
    placement === "right" &&
    target.right + tooltip.width + TOOLTIP_GAP_PX >
      window.innerWidth - VIEWPORT_MARGIN_PX
  ) {
    return "left";
  }

  return placement;
}

function getAlignedCoordinate(
  start: number,
  end: number,
  tooltipSize: number,
  align: TooltipAlign,
) {
  if (align === "start") return start;
  if (align === "end") return end - tooltipSize;
  return start + (end - start - tooltipSize) / 2;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function getTooltipPosition(
  active: ActiveTooltip,
  tooltipElement: HTMLDivElement,
): TooltipPosition {
  const target = active.target.getBoundingClientRect();
  const tooltip = tooltipElement.getBoundingClientRect();
  const placement = flipPlacement(active.placement, target, tooltip);
  let left = 0;
  let top = 0;

  if (placement === "top" || placement === "bottom") {
    left = getAlignedCoordinate(
      target.left,
      target.right,
      tooltip.width,
      active.align,
    );
    top =
      placement === "top"
        ? target.top - tooltip.height - TOOLTIP_GAP_PX
        : target.bottom + TOOLTIP_GAP_PX;
  } else {
    left =
      placement === "left"
        ? target.left - tooltip.width - TOOLTIP_GAP_PX
        : target.right + TOOLTIP_GAP_PX;
    top = getAlignedCoordinate(
      target.top,
      target.bottom,
      tooltip.height,
      active.align,
    );
  }

  return {
    left: clamp(
      left,
      VIEWPORT_MARGIN_PX,
      window.innerWidth - tooltip.width - VIEWPORT_MARGIN_PX,
    ),
    top: clamp(
      top,
      VIEWPORT_MARGIN_PX,
      window.innerHeight - tooltip.height - VIEWPORT_MARGIN_PX,
    ),
  };
}

export function AppTooltipHost() {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current === null) return;
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    };
    const hideImmediately = () => {
      clearShowTimer();
      targetRef.current = null;
      setActive(null);
      setPosition(null);
    };
    const show = (descriptor: ActiveTooltip, immediate: boolean) => {
      clearShowTimer();
      targetRef.current = descriptor.target;
      setPosition(null);

      if (immediate) {
        setActive(descriptor);
        return;
      }

      setActive((current) =>
        current?.target === descriptor.target ? current : null,
      );
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        if (
          targetRef.current === descriptor.target &&
          descriptor.target.isConnected &&
          descriptor.target.matches(":hover")
        ) {
          setActive(descriptor);
        }
      }, TOOLTIP_SHOW_DELAY_MS);
    };
    const handlePointerOver = (event: PointerEvent) => {
      const target = getTooltipTarget(event.target);
      if (!target || target === targetRef.current) return;

      const descriptor = getTooltipDescriptor(target);
      if (descriptor) show(descriptor, false);
    };
    const handlePointerOut = (event: PointerEvent) => {
      const target = targetRef.current;
      if (!target) return;
      if (
        event.relatedTarget instanceof Node &&
        target.contains(event.relatedTarget)
      ) {
        return;
      }

      hideImmediately();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = getTooltipTarget(event.target);
      if (!target || !target.matches(":focus-visible")) return;
      const descriptor = getTooltipDescriptor(target);
      if (descriptor) show(descriptor, true);
    };
    const handleFocusOut = (event: FocusEvent) => {
      const target = targetRef.current;
      if (!target) return;
      if (
        event.relatedTarget instanceof Node &&
        target.contains(event.relatedTarget)
      ) {
        return;
      }

      hideImmediately();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideImmediately();
    };

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("pointerdown", hideImmediately, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      clearShowTimer();
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("pointerdown", hideImmediately, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) return;

    const updatePosition = () => {
      if (!tooltipRef.current || !active.target.isConnected) return;
      setPosition(getTooltipPosition(active, tooltipRef.current));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [active]);

  if (typeof document === "undefined") return null;

  if (!active) {
    return createPortal(<span id="app-tooltip" hidden />, document.body);
  }

  const style: CSSProperties = {
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    maxWidth: "min(24rem, calc(100vw - 1rem))",
    opacity: position ? 1 : 0,
    whiteSpace: "normal",
  };

  return createPortal(
    <div
      ref={tooltipRef}
      id="app-tooltip"
      role="tooltip"
      className={`pointer-events-none fixed z-[11000] break-words text-center transition-opacity duration-150 ${themeClasses.tooltip}`}
      style={style}
    >
      {active.content}
    </div>,
    document.body,
  );
}
