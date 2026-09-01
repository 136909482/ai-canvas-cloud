import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { handleMenuKeyboard } from "@/utils/menuKeyboard";

export type InlineSelectOption = {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  title?: string;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  triggerTrailing?: ReactNode;
  group?: {
    key: string;
    label: string;
    icon?: ReactNode;
  };
  section?: { key: string; label: string; icon?: ReactNode };
  disabled?: boolean;
};

type InlineSelectProps = {
  value: string;
  options: InlineSelectOption[];
  ariaLabel: string;
  onChange: (value: string) => void;
  stopCanvasGesture: (event: SyntheticEvent) => void;
  menuClassName?: string;
  menuPlacement?: "top" | "bottom";
  density?: "compact" | "regular";
  appearance?: "default" | "ghost";
  disabled?: boolean;
};

export function InlineSelect({
  value,
  options,
  ariaLabel,
  onChange,
  stopCanvasGesture,
  menuClassName = "",
  menuPlacement = "bottom",
  density = "regular",
  appearance = "default",
  disabled = false,
}: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];
  const selectedLabel =
    selectedOption?.triggerLabel ?? selectedOption?.label ?? value;
  const triggerAppearanceClassName =
    appearance === "ghost"
      ? open
        ? "border-transparent bg-[var(--control-bg-hover)] text-[var(--text-primary)]"
        : "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
      : open
        ? "border-[var(--accent-violet-strong)] bg-[var(--node-control-bg-hover)] text-[var(--text-primary)] shadow-[0_10px_24px_rgba(0,0,0,0.16)]"
        : "border-[var(--border-subtle)] bg-[var(--node-control-bg)] text-[var(--text-secondary)] hover:border-[var(--accent-violet-muted)] hover:bg-[var(--node-control-bg-hover)]";

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => {
        menuRef.current
          ?.querySelector<HTMLElement>('[aria-selected="true"]')
          ?.focus();
      });
    }
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onPointerDown={stopCanvasGesture}
      onMouseDown={stopCanvasGesture}
      onClick={stopCanvasGesture}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`nowheel nodrag nopan flex w-full items-center justify-between rounded-md border text-left font-medium transition-all ${
          density === "compact"
            ? "h-7 gap-1.5 px-2 text-[10px] leading-4"
            : "h-9 gap-2 px-3 text-xs leading-5"
        } ${triggerAppearanceClassName}`}
        title={selectedOption?.title ?? value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onClick={(event) => {
          stopCanvasGesture(event);
          setOpen((current) => !current);
        }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {selectedOption?.triggerIcon ?? selectedOption?.icon}
          <span className="min-w-0 flex-1 truncate leading-5">
            {selectedLabel}
          </span>
          <span className="ml-auto flex shrink-0 items-center">
            {selectedOption?.triggerTrailing ?? selectedOption?.trailing}
          </span>
        </span>
        <ChevronDown
          className={`${density === "compact" ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180 text-[var(--text-secondary)]" : ""}`}
        />
      </button>

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          className={`nowheel nodrag nopan absolute left-0 right-0 z-40 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] p-1.5 shadow-[var(--shadow-panel)] backdrop-blur-xl ${menuPlacement === "top" ? "bottom-full mb-2" : "top-full mt-2"} ${menuClassName}`}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={(event) =>
            handleMenuKeyboard(event.nativeEvent, menuRef.current, closeMenu)
          }
          onPointerDown={stopCanvasGesture}
          onMouseDown={stopCanvasGesture}
          onClick={stopCanvasGesture}
          onWheelCapture={stopCanvasGesture}
        >
          <div
            className="scrollbar-hidden nowheel max-h-52 overflow-y-auto overscroll-contain"
            onWheelCapture={stopCanvasGesture}
          >
            {options.map((option, index) => {
              const active = option.value === value;
              const previousGroup = options[index - 1]?.group;
              const showGroup =
                option.group && option.group.key !== previousGroup?.key;
              const previousSection = options[index - 1]?.section;
              const showSection =
                option.section && option.section.key !== previousSection?.key;

              return (
                <Fragment key={option.value}>
                  {showSection ? (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)]">
                      {option.section?.icon}
                      <span className="min-w-0 truncate">
                        {option.section?.label}
                      </span>
                    </div>
                  ) : null}
                  {showGroup ? (
                    <div
                      role="presentation"
                      className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)] ${index > 0 ? "mt-1 border-t border-[var(--border-subtle)] pt-2" : ""}`}
                    >
                      {option.group?.icon}
                      <span className="min-w-0 truncate">
                        {option.group?.label}
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={option.disabled}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs leading-5 transition-colors ${
                      option.disabled
                        ? "cursor-not-allowed text-[var(--text-muted)] opacity-70"
                        : active
                          ? "bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)] shadow-[inset_0_0_0_1px_var(--accent-violet-muted)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                    onClick={(event) => {
                      stopCanvasGesture(event);
                      if (option.disabled) return;
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span
                      className={`flex min-w-0 items-center gap-1.5 ${option.group ? "pl-5" : ""}`}
                    >
                      {option.icon}
                      <span className="min-w-0 truncate" title={option.title}>
                        {option.label}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {option.trailing}
                      {active ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-violet-strong)]" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
