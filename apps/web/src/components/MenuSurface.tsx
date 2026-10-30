import {
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useViewportMenuPosition } from "@/hooks/useViewportMenuPosition";

type MenuSurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open: boolean;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode | (() => ReactNode);
  anchorRef?: RefObject<HTMLElement | null>;
  placement?: "top" | "bottom";
};

// Keep a closing menu briefly for its fade, but disable interaction immediately.
// Children are mounted only while opening/open/closing, not for every canvas node.
export function MenuSurface({
  open,
  ref,
  className = "",
  children,
  anchorRef,
  placement = "bottom",
  ...props
}: MenuSurfaceProps) {
  const [present, setPresent] = useState(open);
  const menuRef = useRef<HTMLDivElement>(null);
  useViewportMenuPosition(open, anchorRef, menuRef, placement);

  useLayoutEffect(() => {
    if (open) {
      if (!present) setPresent(true);
      return;
    }
    if (!present) return;
    const timeout = window.setTimeout(() => setPresent(false), 120);
    return () => window.clearTimeout(timeout);
  }, [open, present]);

  if (!open && !present) return null;

  return (
    <div
      {...props}
      ref={(element) => {
        menuRef.current = element;
        if (typeof ref === "function") return ref(element);
        if (ref) ref.current = element;
      }}
      className={`ui-menu-surface ${className}`}
      data-state={open ? "open" : "closed"}
      aria-hidden={!open || undefined}
      inert={!open}
    >
      {typeof children === "function" ? children() : children}
    </div>
  );
}
