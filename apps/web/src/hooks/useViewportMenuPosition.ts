import { useLayoutEffect, type RefObject } from "react";
import { getViewportMenuPosition } from "@/utils/viewportMenuPosition";

// Keep menus in their original DOM tree so outside-click and dialog focus handling
// still work, even when a transformed node toolbar is their containing block.
export function useViewportMenuPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  menuRef: RefObject<HTMLElement | null>,
  placement: "top" | "bottom",
) {
  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    const menu = menuRef.current;
    if (!open || !anchor || !menu) return;

    const updatePosition = () => {
      menu.style.translate = "";
      menu.style.maxHeight = "";
      menu.style.maxWidth = "";
      const initial = menu.getBoundingClientRect();
      const scaleX = initial.width / menu.offsetWidth || 1;
      const scaleY = initial.height / menu.offsetHeight || 1;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      menu.style.maxWidth = `${Math.max(0, viewportWidth - 24) / scaleX}px`;
      const rect = menu.getBoundingClientRect();
      const position = getViewportMenuPosition(
        anchor.getBoundingClientRect(),
        rect,
        { width: viewportWidth, height: viewportHeight },
        placement,
      );
      // Preserve the menu's own CSS height cap; expanding after placement would
      // invalidate the measured top edge of an upward-opening menu.
      menu.style.maxHeight = `${Math.min(rect.height, position.maxHeight) / scaleY}px`;
      menu.style.overflowY = "auto";
      const constrained = menu.getBoundingClientRect();
      menu.style.translate = `${(position.left - constrained.left) / scaleX}px ${(position.top - constrained.top) / scaleY}px`;
    };

    updatePosition();
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(anchor);
    resizeObserver.observe(menu);
    const toolbar = anchor.closest(".react-flow__node-toolbar");
    const toolbarObserver = new MutationObserver(updatePosition);
    if (toolbar)
      toolbarObserver.observe(toolbar, {
        attributes: true,
        attributeFilter: ["style"],
      });
    const handleScroll = (event: Event) => {
      // Scrolling options must not reset the menu's scroll position by measuring
      // it temporarily without its height limit.
      if (event.target instanceof Node && menu.contains(event.target)) return;
      updatePosition();
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      resizeObserver.disconnect();
      toolbarObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, anchorRef, menuRef, placement]);
}
