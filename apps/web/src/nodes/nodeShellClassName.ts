const NODE_SHELL_BASE_CLASS =
  "node-shell group relative flex h-full w-full flex-col overflow-visible rounded-lg border bg-[var(--node-bg)] text-[var(--text-primary)] shadow-[var(--shadow-node)] transition-[border-color,box-shadow] duration-150";
const NODE_SHELL_SELECTED_CLASS =
  "border-[var(--accent-violet)] shadow-[var(--shadow-node-selected)]";
const NODE_SHELL_UNSELECTED_CLASS =
  "border-[var(--node-border)] hover:border-[var(--node-border-hover)]";

type NodeShellClassNameOptions = {
  selected: boolean;
  className?: string;
};

export function getNodeShellClassName({
  selected,
  className = "",
}: NodeShellClassNameOptions) {
  return [
    NODE_SHELL_BASE_CLASS,
    selected ? NODE_SHELL_SELECTED_CLASS : NODE_SHELL_UNSELECTED_CLASS,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}
