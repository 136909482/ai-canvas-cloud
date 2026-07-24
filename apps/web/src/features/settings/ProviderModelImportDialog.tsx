import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Video,
  X,
} from "lucide-react";
import {
  cx,
  type DraftProviderProfile,
} from "@/components/toolbar/settingsModel";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import type { ModelCategory, ModelEntry } from "@/types";
import { validateProviderProfileDraft } from "./providerConfig";
import {
  ProviderModelsDiscoveryController,
  type DiscoveredProviderModel,
  type ProviderModelImportSelection,
} from "./providerModelDiscovery";

interface ImportItem extends DiscoveredProviderModel {
  category: ModelCategory;
  selected: boolean;
  alreadyImported: boolean;
}

interface DiscoveryResult {
  models: DiscoveredProviderModel[];
  baseUrl: string;
  discardedCount: number;
  truncated: boolean;
  ignoredQuery: boolean;
  ignoredFragment: boolean;
}

export interface ProviderModelImportDialogProps {
  open: boolean;
  draft: DraftProviderProfile | null;
  existingEntries: readonly ModelEntry[];
  onClose: (hasPendingSelection: boolean) => void;
  onConfirm: (input: {
    baseUrl: string;
    discoveredModelIds: string[];
    selectedModels: ProviderModelImportSelection[];
  }) => Promise<void>;
}

const CATEGORY_META = {
  chat: {
    label: "Chat",
    Icon: MessageSquareText,
    className: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  },
  image: {
    label: "图像",
    Icon: ImageIcon,
    className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  },
  video: {
    label: "视频",
    Icon: Video,
    className: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  },
};

const CATEGORY_ORDER: ModelCategory[] = ["chat", "image", "video"];

function getExistingModelIds(
  draft: DraftProviderProfile | null,
  entries: readonly ModelEntry[],
) {
  if (!draft) return new Set<string>();
  return new Set(
    entries
      .filter((entry) => entry.providerProfileId === draft.id)
      .map((entry) => entry.modelId),
  );
}

export function ProviderModelImportDialog({
  open,
  draft,
  existingEntries,
  onClose,
  onConfirm,
}: ProviderModelImportDialogProps) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<{
    message: string;
    responsePreview?: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "saving">(
    "idle",
  );
  const discoveryController = useRef(new ProviderModelsDiscoveryController());
  const abortController = useRef<AbortController | null>(null);

  const selectedItems = items.filter(
    (item) => item.selected && !item.alreadyImported,
  );
  const dialogRef = useDialogFocus<HTMLDivElement>(
    open,
    () => onClose(selectedItems.length > 0),
    "[data-autofocus]",
  );

  const requestDiscovery = useCallback(async () => {
    if (!draft) return;
    const diagnostic = validateProviderProfileDraft(draft, draft.apiKey);
    if (diagnostic) {
      setError({ message: diagnostic.message });
      setPhase("idle");
      return;
    }

    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setPhase("loading");
    setError(null);

    const response = await discoveryController.current.discover({
      providerProfileId: draft.id,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      signal: controller.signal,
    });
    if (abortController.current !== controller) return;
    if (!response.ok) {
      if (response.error.code !== "cancelled") {
        setError({
          message: response.error.message,
          ...(response.error.responsePreview
            ? { responsePreview: response.error.responsePreview }
            : {}),
        });
      }
      setPhase("idle");
      return;
    }

    const existingIds = getExistingModelIds(draft, existingEntries);
    setItems(
      response.models.map((model) => ({
        ...model,
        category: model.suggestedCategory,
        selected: false,
        alreadyImported: existingIds.has(model.modelId),
      })),
    );
    setResult({
      models: response.models,
      baseUrl: response.baseUrl,
      discardedCount: response.discardedCount,
      truncated: response.truncated,
      ignoredQuery: response.ignoredQuery,
      ignoredFragment: response.ignoredFragment,
    });
    setPhase("ready");
  }, [draft, existingEntries]);

  useEffect(() => {
    if (!open) return;
    void requestDiscovery();
    return () => abortController.current?.abort();
  }, [open, requestDiscovery]);

  useEffect(() => {
    if (open) return;
    setItems([]);
    setResult(null);
    setError(null);
    setQuery("");
    setPhase("idle");
  }, [open]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) =>
      normalizedQuery
        ? item.modelId.toLowerCase().includes(normalizedQuery) ||
          item.ownedBy?.toLowerCase().includes(normalizedQuery)
        : true,
    );
  }, [items, query]);

  const groupedVisibleItems = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: visibleItems.filter((item) => item.category === category),
      })).filter((group) => group.items.length > 0),
    [visibleItems],
  );

  const toggleItemSelection = (modelId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.modelId === modelId && !item.alreadyImported
          ? { ...item, selected: !item.selected }
          : item,
      ),
    );
  };

  const submit = async () => {
    if (!result || phase !== "ready") return;
    setPhase("saving");
    try {
      await onConfirm({
        baseUrl: result.baseUrl,
        discoveredModelIds: result.models.map((model) => model.modelId),
        selectedModels: selectedItems.map((item) => ({
          modelId: item.modelId,
          category: item.category,
        })),
      });
      onClose(false);
    } catch {
      setError({
        message: "无法保存本地 Vault，请检查浏览器存储权限后重试。",
      });
      setPhase("ready");
    }
  };

  if (!open || !draft) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-5">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="取消导入"
        onClick={() => onClose(selectedItems.length > 0)}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-model-import-title"
        tabIndex={-1}
        className="relative flex shrink-0 flex-col overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] shadow-2xl"
        style={{
          width: "min(820px, calc(100vw - 1rem))",
          height: "min(460px, calc(100dvh - 1rem))",
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2
              id="provider-model-import-title"
              className="truncate text-sm font-semibold text-[var(--text-primary)]"
            >
              获取模型列表
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
              从当前服务商的 OpenAI Compatible /v1/models 读取目录
            </p>
          </div>
          <button
            type="button"
            title="取消导入"
            onClick={() => onClose(selectedItems.length > 0)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="取消导入"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {phase === "loading" ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-xs text-[var(--text-secondary)]">
              <LoaderCircle className="h-5 w-5 animate-spin text-violet-400" />
              正在获取模型目录
            </div>
          ) : null}

          {error ? (
            <div className="space-y-3">
              <div className="flex gap-2 rounded-[7px] border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error.message}</span>
              </div>
              {error.responsePreview ? (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                  {error.responsePreview}
                </pre>
              ) : null}
              <button
                type="button"
                data-autofocus
                onClick={() => void requestDiscovery()}
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
            </div>
          ) : null}

          {phase === "ready" && result ? (
            <div className="space-y-3">
              {result.truncated ||
              result.discardedCount > 0 ||
              result.ignoredQuery ||
              result.ignoredFragment ? (
                <div className="flex gap-2 rounded-[7px] border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-[11px] leading-5 text-sky-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {result.truncated ? "目录超过 2000 项，已截断。" : ""}
                    {result.discardedCount > 0
                      ? `已忽略 ${result.discardedCount} 个无效或重复项。`
                      : ""}
                    {result.ignoredQuery || result.ignoredFragment
                      ? "地址中的查询参数或片段已忽略。"
                      : ""}
                  </span>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    data-autofocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索模型 ID 或 owner"
                    className="h-9 w-full rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)] pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-violet-400/60"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void requestDiscovery()}
                  aria-label="重新获取模型列表"
                  title="重新获取模型列表"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  模型 {visibleItems.length}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  已按类型分组
                </span>
              </div>

              {visibleItems.length > 0 ? (
                <div className="space-y-3">
                  {groupedVisibleItems.map((group) => {
                    const categoryMeta = CATEGORY_META[group.category];
                    const CategoryIcon = categoryMeta.Icon;
                    const groupTitleId = `provider-model-category-${group.category}`;
                    return (
                      <section
                        key={group.category}
                        aria-labelledby={groupTitleId}
                        className="overflow-hidden rounded-[7px] border border-[var(--border-subtle)]"
                      >
                        <div className="flex h-8 items-center gap-2 border-b border-[var(--border-subtle)] bg-black/15 px-3">
                          <span
                            className={cx(
                              "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                              categoryMeta.className,
                            )}
                          >
                            <CategoryIcon className="h-3 w-3" />
                          </span>
                          <h3
                            id={groupTitleId}
                            className="text-[11px] font-semibold text-[var(--text-secondary)]"
                          >
                            {categoryMeta.label}
                          </h3>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {group.items.length}
                          </span>
                        </div>
                        <div role="list">
                          {group.items.map((item) => {
                            const itemCategoryMeta =
                              CATEGORY_META[item.category];
                            const ItemCategoryIcon = itemCategoryMeta.Icon;
                            return (
                              <div
                                key={item.modelId}
                                role="listitem"
                                className="flex min-w-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--control-bg)] px-3 py-2.5 last:border-b-0"
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-orange-400/20 bg-orange-400/10 text-[10px] font-semibold text-orange-200">
                                  {item.modelId.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                                      {item.modelId}
                                    </span>
                                    {item.alreadyImported ? (
                                      <span className="shrink-0 rounded-[4px] bg-emerald-400/15 px-1 py-0.5 text-[9px] text-emerald-200">
                                        已添加
                                      </span>
                                    ) : null}
                                  </span>
                                  {item.ownedBy ? (
                                    <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                                      {item.ownedBy}
                                    </span>
                                  ) : null}
                                </span>
                                <span
                                  title={`自动识别为${itemCategoryMeta.label}`}
                                  className={cx(
                                    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                                    itemCategoryMeta.className,
                                  )}
                                >
                                  <ItemCategoryIcon className="h-3 w-3" />
                                </span>
                                {item.requiresCategoryConfirmation ? (
                                  <span
                                    title="未识别名称按 Chat 导入，之后可在模型设置中修改"
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-amber-200"
                                  >
                                    <CircleHelp className="h-3.5 w-3.5" />
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={item.alreadyImported}
                                  onClick={() =>
                                    toggleItemSelection(item.modelId)
                                  }
                                  aria-label={
                                    item.alreadyImported
                                      ? `${item.modelId} 已添加`
                                      : item.selected
                                        ? `移出待导入 ${item.modelId}`
                                        : `添加 ${item.modelId}`
                                  }
                                  title={
                                    item.alreadyImported
                                      ? "已添加"
                                      : item.selected
                                        ? "移出待导入"
                                        : "添加模型"
                                  }
                                  className={cx(
                                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                                    item.alreadyImported
                                      ? "cursor-default text-emerald-300"
                                      : item.selected
                                        ? "bg-violet-400/15 text-violet-200 hover:bg-violet-400/25"
                                        : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]",
                                  )}
                                >
                                  {item.alreadyImported || item.selected ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <Plus className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-36 items-center justify-center text-xs text-[var(--text-muted)]">
                  没有匹配的模型
                </div>
              )}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-3 sm:px-5">
          <span className="text-[11px] text-[var(--text-muted)]">
            {phase === "ready"
              ? selectedItems.length > 0
                ? `将导入 ${selectedItems.length} 个模型`
                : "选择 + 后导入模型"
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onClose(selectedItems.length > 0)}
              className="h-8 rounded-[7px] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)]"
            >
              取消
            </button>
            <button
              type="button"
              disabled={phase !== "ready"}
              onClick={() => void submit()}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)] disabled:cursor-not-allowed disabled:opacity-45",
                phase === "saving" && "opacity-70",
              )}
            >
              {phase === "saving" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {selectedItems.length > 0 ? "确认导入" : "同步目录"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
