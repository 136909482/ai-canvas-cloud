import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleHelp,
  Image as ImageIcon,
  LayoutGrid,
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
import { ModelOptionIcon } from "@/components/icons/ModelOptionIcon";
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
  onClose: () => void;
  onAddModel: (input: {
    baseUrl: string;
    discoveredModelIds: string[];
    selectedModels: ProviderModelImportSelection[];
  }) => Promise<void>;
}

const CATEGORY_META = {
  chat: {
    label: "Chat",
    Icon: MessageSquareText,
    className: "border-violet-400/25 bg-violet-400/10 text-violet-300",
  },
  image: {
    label: "图片",
    Icon: ImageIcon,
    className: "border-violet-400/25 bg-violet-400/10 text-violet-300",
  },
  video: {
    label: "视频",
    Icon: Video,
    className: "border-violet-400/25 bg-violet-400/10 text-violet-300",
  },
};

const CATEGORY_ORDER: ModelCategory[] = ["chat", "image", "video"];
type CategoryFilter = "all" | ModelCategory;

const CATEGORY_FILTERS: Array<{
  value: CategoryFilter;
  label: string;
  Icon: typeof LayoutGrid;
}> = [
  { value: "all", label: "全部", Icon: LayoutGrid },
  ...CATEGORY_ORDER.map((category) => ({
    value: category,
    label: CATEGORY_META[category].label,
    Icon: CATEGORY_META[category].Icon,
  })),
];

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
  onAddModel,
}: ProviderModelImportDialogProps) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<{
    message: string;
    responsePreview?: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [collapsedCategories, setCollapsedCategories] = useState<
    ReadonlySet<ModelCategory>
  >(() => new Set());
  const [phase, setPhase] = useState<"idle" | "loading" | "ready">("idle");
  const [savingModelId, setSavingModelId] = useState<string | null>(null);
  const discoveryController = useRef(new ProviderModelsDiscoveryController());
  const abortController = useRef<AbortController | null>(null);
  const wasOpen = useRef(false);

  const dialogRef = useDialogFocus<HTMLDivElement>(
    open,
    onClose,
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
    if (open && !wasOpen.current) void requestDiscovery();
    if (!open && wasOpen.current) abortController.current?.abort();
    wasOpen.current = open;
  }, [open, requestDiscovery]);

  useEffect(() => () => abortController.current?.abort(), []);

  useEffect(() => {
    if (open) return;
    setItems([]);
    setResult(null);
    setError(null);
    setQuery("");
    setCategoryFilter("all");
    setCollapsedCategories(new Set());
    setSavingModelId(null);
    setPhase("idle");
  }, [open]);

  const queryMatchedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        !normalizedQuery ||
        item.modelId.toLowerCase().includes(normalizedQuery),
    );
  }, [items, query]);

  const visibleItems = useMemo(
    () =>
      categoryFilter === "all"
        ? queryMatchedItems
        : queryMatchedItems.filter((item) => item.category === categoryFilter),
    [categoryFilter, queryMatchedItems],
  );

  const categoryCounts = useMemo(
    () => ({
      all: queryMatchedItems.length,
      chat: queryMatchedItems.filter((item) => item.category === "chat").length,
      image: queryMatchedItems.filter((item) => item.category === "image")
        .length,
      video: queryMatchedItems.filter((item) => item.category === "video")
        .length,
    }),
    [queryMatchedItems],
  );

  const groupedVisibleItems = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: visibleItems.filter((item) => item.category === category),
      })).filter((group) => group.items.length > 0),
    [visibleItems],
  );

  const toggleCategory = (category: ModelCategory) => {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const addModel = async (item: ImportItem) => {
    if (!result || phase !== "ready" || item.alreadyImported || savingModelId)
      return;
    setSavingModelId(item.modelId);
    setError(null);
    try {
      await onAddModel({
        baseUrl: result.baseUrl,
        discoveredModelIds: result.models.map((model) => model.modelId),
        selectedModels: [
          {
            modelId: item.modelId,
            category: item.category,
          },
        ],
      });
      setItems((current) =>
        current.map((candidate) =>
          candidate.modelId === item.modelId
            ? { ...candidate, alreadyImported: true }
            : candidate,
        ),
      );
    } catch {
      setError({
        message: `无法添加 ${item.modelId}，请检查浏览器存储权限后重试。`,
      });
    } finally {
      setSavingModelId(null);
    }
  };

  if (!open || !draft) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-5">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭模型列表"
        onClick={onClose}
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
            title="关闭"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="project-manager-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable] sm:px-5">
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
                    placeholder="搜索模型 ID"
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

              <div className="flex flex-wrap items-center gap-2 px-1">
                <span className="inline-flex w-[3.75rem] shrink-0 items-center text-[11px] font-semibold text-[var(--text-secondary)]">
                  模型
                  <span className="ml-1 inline-block w-[4ch] tabular-nums">
                    {visibleItems.length}
                  </span>
                </span>
                <div
                  role="tablist"
                  aria-label="按模型类型筛选"
                  className="flex min-w-0 flex-wrap items-center gap-1"
                >
                  {CATEGORY_FILTERS.map((filter) => {
                    const active = categoryFilter === filter.value;
                    const FilterIcon = filter.Icon;
                    return (
                      <button
                        key={filter.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setCategoryFilter(filter.value)}
                        className={cx(
                          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                          active
                            ? "border-[var(--text-secondary)] bg-[var(--text-primary)] text-[var(--canvas-bg)]"
                            : "border-[var(--border-subtle)] bg-[var(--control-bg)] text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]",
                        )}
                      >
                        <FilterIcon className="h-3 w-3" />
                        <span>{filter.label}</span>
                        <span
                          className={cx(
                            "tabular-nums",
                            active
                              ? "text-[var(--canvas-bg)]/65"
                              : "text-[var(--text-muted)]",
                          )}
                        >
                          {categoryCounts[filter.value]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {visibleItems.length > 0 ? (
                <div className="space-y-3">
                  {groupedVisibleItems.map((group) => {
                    const categoryMeta = CATEGORY_META[group.category];
                    const CategoryIcon = categoryMeta.Icon;
                    const groupTitleId = `provider-model-category-${group.category}`;
                    const groupListId = `${groupTitleId}-list`;
                    const expanded = !collapsedCategories.has(group.category);
                    return (
                      <section
                        key={group.category}
                        aria-labelledby={groupTitleId}
                        className="overflow-hidden rounded-[7px] border border-[var(--border-subtle)]"
                      >
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={groupListId}
                          onClick={() => toggleCategory(group.category)}
                          className={cx(
                            "flex h-8 w-full items-center gap-2 bg-black/15 px-3 text-left transition-colors hover:bg-[var(--control-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/60",
                            expanded &&
                              "border-b border-[var(--border-subtle)]",
                          )}
                        >
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
                          <ChevronDown
                            className={cx(
                              "ml-auto h-3.5 w-3.5 shrink-0 text-violet-300 transition-transform duration-200",
                              !expanded && "-rotate-90",
                            )}
                          />
                        </button>
                        {expanded ? (
                          <div id={groupListId} role="list">
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
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                                    <ModelOptionIcon model={item} />
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
                                    disabled={
                                      item.alreadyImported ||
                                      savingModelId !== null
                                    }
                                    onClick={() => void addModel(item)}
                                    aria-label={
                                      item.alreadyImported
                                        ? `${item.modelId} 已添加`
                                        : savingModelId === item.modelId
                                          ? `正在添加 ${item.modelId}`
                                          : `添加 ${item.modelId}`
                                    }
                                    title={
                                      item.alreadyImported
                                        ? "已添加"
                                        : savingModelId === item.modelId
                                          ? "正在添加"
                                          : "添加模型"
                                    }
                                    className={cx(
                                      "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                                      item.alreadyImported
                                        ? "cursor-default text-emerald-300"
                                        : savingModelId === item.modelId
                                          ? "bg-violet-400/15 text-violet-200 hover:bg-violet-400/25"
                                          : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]",
                                    )}
                                  >
                                    {savingModelId === item.modelId ? (
                                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                    ) : item.alreadyImported ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Plus className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
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
      </div>
    </div>,
    document.body,
  );
}
