import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { Handle, Position } from "@xyflow/react";
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  ScanSearch,
  Sofa,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  recognizeInteriorParts,
  runInteriorRefurnish,
} from "@/features/interiorRefurnish/execute";
import {
  getAvailableRefurnishParts,
  MAX_REFURNISH_REQUIREMENTS,
} from "@/features/interiorRefurnish/runtime";
import {
  getNodeModelIssueLabel,
  getNodeModelSelection,
} from "@/features/settings/nodeModelSelection";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { AppNodeProps, InteriorRefurnishBinding } from "@/types";
import { InlineSelect, type InlineSelectOption } from "../InlineSelect";
import { NodeModelSelector } from "../NodeModelSelector";
import { NodeDeleteButton, NodeHeader, NodeResizerPreset } from "../nodeShell";
import { getNodeShellClassName } from "../nodeShellClassName";

type Props = AppNodeProps<"interiorRefurnishNode">;

const MIN_REFURNISH_NODE_HEIGHT = 440;
const AUTO_RESIZE_MEASUREMENT_BUFFER = 2;
const AUTO_RESIZE_COMPATIBLE_HEIGHTS = new Set([440, 479, 480, 560]);
const PRODUCT_ORDER_MARKERS = ["①", "②", "③", "④"] as const;

export const InteriorRefurnishNode = memo(function InteriorRefurnishNode({
  id,
  data,
  selected,
}: Props) {
  const [manualDraft, setManualDraft] = useState("");
  const [contentMinHeight, setContentMinHeight] = useState(
    MIN_REFURNISH_NODE_HEIGHT,
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoResizeEnabledRef = useRef<boolean | null>(null);
  const { nodes, updateNodeData, onNodesChange, deleteNode } = useCanvasStore(
    useShallow((state) => ({
      nodes: state.nodes,
      updateNodeData: state.updateNodeData,
      onNodesChange: state.onNodesChange,
      deleteNode: state.deleteNode,
    })),
  );
  const runTracked = useHistoryStore((state) => state.runTracked);
  const config = useSettingsStore((state) => state.config);
  const scene = nodes.find((node) => node.id === data.sceneSourceNodeId);
  const products = data.productSourceOrder
    .map((sourceId) => nodes.find((node) => node.id === sourceId))
    .filter((node) => Boolean(node));
  const parts = getAvailableRefurnishParts(
    data.recognizedParts,
    data.manualParts,
  );
  const partOptions = useMemo<InlineSelectOption[]>(
    () => [
      {
        value: "",
        label: parts.length ? "选择部件" : "暂无可选部件",
        disabled: !parts.length,
      },
      ...parts.map((part) => ({ value: part, label: part })),
    ],
    [parts],
  );
  const resolutionOptions = useMemo<InlineSelectOption[]>(
    () =>
      ["1K", "2K", "4K"].map((value) => ({
        value,
        label: value,
      })),
    [],
  );
  const recognitionSelection = useMemo(
    () =>
      getNodeModelSelection(config, {
        category: "chat",
        reference: data.recognitionModel,
      }),
    [config, data.recognitionModel],
  );
  const imageSelection = useMemo(
    () =>
      getNodeModelSelection(config, {
        category: "image",
        reference: data.model,
      }),
    [config, data.model],
  );
  const isBusy = data.status === "queued" || data.status === "generating";
  const isRecognizing = data.recognitionStatus === "recognizing";
  const stopCanvasGesture = (event: SyntheticEvent) => event.stopPropagation();

  useLayoutEffect(() => {
    const root = rootRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!root || !viewport || !content) return;

    const currentNode = useCanvasStore
      .getState()
      .nodes.find((node) => node.id === id);
    const currentHeight =
      typeof currentNode?.height === "number"
        ? currentNode.height
        : MIN_REFURNISH_NODE_HEIGHT;
    if (autoResizeEnabledRef.current === null) {
      autoResizeEnabledRef.current =
        currentNode?.data?.autoResizeHeight === currentHeight ||
        AUTO_RESIZE_COMPATIBLE_HEIGHTS.has(currentHeight);
    }
    let frame = 0;
    const resizeToContent = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const chromeHeight = root.clientHeight - viewport.clientHeight;
        const requiredHeight = Math.max(
          MIN_REFURNISH_NODE_HEIGHT,
          Math.ceil(
            chromeHeight +
              content.scrollHeight +
              AUTO_RESIZE_MEASUREMENT_BUFFER,
          ),
        );
        setContentMinHeight((current) =>
          current === requiredHeight ? current : requiredHeight,
        );
        const latestNode = useCanvasStore
          .getState()
          .nodes.find((node) => node.id === id);
        const latestHeight =
          typeof latestNode?.height === "number"
            ? latestNode.height
            : MIN_REFURNISH_NODE_HEIGHT;
        const nextHeight = autoResizeEnabledRef.current
          ? requiredHeight
          : Math.max(latestHeight, requiredHeight);
        if (latestHeight !== nextHeight) {
          onNodesChange([
            {
              id,
              type: "dimensions",
              dimensions: {
                width: latestNode?.width ?? root.clientWidth,
                height: nextHeight,
              },
              setAttributes: true,
            },
          ]);
        }
        if (
          autoResizeEnabledRef.current &&
          latestNode?.data?.autoResizeHeight !== nextHeight
        ) {
          updateNodeData(id, { autoResizeHeight: nextHeight });
        }
      });
    };

    const observer = new ResizeObserver(resizeToContent);
    observer.observe(content);
    resizeToContent();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [id, onNodesChange, updateNodeData]);

  const setBinding = (sourceNodeId: string, partName: string) => {
    runTracked(() => {
      const next = (data.bindings ?? []).filter(
        (binding) =>
          binding.sourceNodeId !== sourceNodeId &&
          (!partName || binding.partName !== partName),
      );
      if (partName) next.push({ sourceNodeId, partName });
      const ordered = data.productSourceOrder
        .map((id) => next.find((binding) => binding.sourceNodeId === id))
        .filter((binding): binding is InteriorRefurnishBinding =>
          Boolean(binding),
        );
      updateNodeData(id, { bindings: ordered, errorMsg: "" });
    });
  };

  const addManualPart = () => {
    const part = manualDraft.trim().slice(0, 24);
    if (!part || parts.includes(part) || parts.length >= 15) return;
    runTracked(() =>
      updateNodeData(id, { manualParts: [...data.manualParts, part] }),
    );
    setManualDraft("");
  };

  const removePart = (part: string) => {
    runTracked(() =>
      updateNodeData(id, {
        recognizedParts: data.recognizedParts.filter((item) => item !== part),
        manualParts: data.manualParts.filter((item) => item !== part),
        bindings: data.bindings.filter((binding) => binding.partName !== part),
      }),
    );
  };

  return (
    <div
      ref={rootRef}
      className={getNodeShellClassName({ selected })}
      data-testid={`node-${id}`}
    >
      <NodeResizerPreset
        selected={selected}
        minWidth={380}
        minHeight={contentMinHeight}
        maxWidth={680}
        onResizeStart={() => {
          autoResizeEnabledRef.current = false;
          updateNodeData(id, { autoResizeHeight: null });
        }}
        hideVisuals
      />
      <NodeDeleteButton
        id={id}
        selected={selected}
        ariaLabel="删除 AI 换软装节点"
        onDelete={() => runTracked(() => deleteNode(id))}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="scene"
        className="handle-orb-anchor !top-[27%] !h-[18px] !w-[18px] !border-0 !bg-transparent"
        title="场景图"
      >
        <span className="handle-orb handle-orb--target">
          <span className="handle-orb__glow" />
          <span className="handle-orb__ring" />
          <span className="handle-orb__dot" />
        </span>
      </Handle>
      <Handle
        type="target"
        position={Position.Left}
        id="product"
        className="handle-orb-anchor !top-[60%] !h-[18px] !w-[18px] !border-0 !bg-transparent"
        title="商品图"
      >
        <span className="handle-orb handle-orb--target">
          <span className="handle-orb__glow" />
          <span className="handle-orb__ring" />
          <span className="handle-orb__dot" />
        </span>
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        className="handle-orb-anchor !h-[18px] !w-[18px] !border-0 !bg-transparent"
        title="结果图"
      >
        <span className="handle-orb handle-orb--source">
          <span className="handle-orb__glow" />
          <span className="handle-orb__ring" />
          <span className="handle-orb__dot" />
        </span>
      </Handle>

      <NodeHeader
        icon={
          <Sofa className="h-3.5 w-3.5 text-[var(--accent-violet-strong)]" />
        }
        title="AI 换软装"
        right={
          <span className="text-[9px] text-[var(--text-muted)]">最多 4 件</span>
        }
      />
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden"
      >
        <div ref={contentRef} className="flex flex-col gap-2 p-2">
          <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--control-bg)] p-2">
            <div className="flex items-center justify-between text-[10px] font-semibold text-[var(--text-secondary)]">
              <span>场景与识别</span>
              <span
                className={
                  scene
                    ? "text-[var(--accent-violet-strong)]"
                    : "text-[var(--text-muted)]"
                }
              >
                {scene ? "已接入" : "连接场景图"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <NodeModelSelector
                  category="chat"
                  config={config}
                  selection={recognitionSelection}
                  onSelectModel={(recognitionModel) =>
                    updateNodeData(id, {
                      recognitionModel,
                      recognitionError: "",
                    })
                  }
                  stopCanvasGesture={stopCanvasGesture}
                  providerAriaLabel="选择识别服务商"
                  modelAriaLabel="选择识别模型"
                  layout="grouped"
                  menuPlacement="bottom"
                />
              </div>
              <button
                type="button"
                className="nodrag nopan flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 text-[10px] font-medium hover:bg-[var(--control-bg-hover)] disabled:opacity-45"
                disabled={
                  !scene || isRecognizing || !recognitionSelection.canExecute
                }
                onClick={() => void recognizeInteriorParts(id)}
              >
                {isRecognizing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ScanSearch className="h-3.5 w-3.5" />
                )}
                识别部件
              </button>
            </div>
            {!recognitionSelection.canExecute && (
              <p className="mt-1 text-[9px] text-amber-500">
                {getNodeModelIssueLabel(recognitionSelection)}
              </p>
            )}
            {data.recognitionError && (
              <p className="mt-1 text-[9px] text-red-500">
                {data.recognitionError}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {parts.map((part) => (
                <span
                  key={part}
                  className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--node-bg)] px-1.5 text-[9px]"
                >
                  {part}
                  <button
                    type="button"
                    title={`删除${part}`}
                    onClick={() => removePart(part)}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {!parts.length && (
                <span className="text-[9px] text-[var(--text-muted)]">
                  识别失败时可手工添加
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-1">
              <input
                className="nodrag nopan h-7 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--node-bg)] px-2 text-[10px] outline-none"
                value={manualDraft}
                maxLength={24}
                placeholder="添加部件，如：沙发"
                onChange={(event) => setManualDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addManualPart();
                }}
              />
              <button
                type="button"
                title="添加部件"
                className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-subtle)]"
                onClick={addManualPart}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </section>

          <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--control-bg)] p-2">
            <div className="flex items-center justify-between text-[10px] font-semibold text-[var(--text-secondary)]">
              <span>商品图绑定</span>
              <span className="text-[var(--accent-violet-strong)]">
                {products.length}/4
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {products.map((product, index) => {
                const binding = data.bindings.find(
                  (item) => item.sourceNodeId === product?.id,
                );
                return (
                  <div
                    key={product?.id}
                    className="flex h-8 items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--node-bg)] px-2"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-[12px] font-medium text-[var(--accent-violet-strong)]"
                      aria-label={`第 ${index + 1} 张商品图`}
                      title={`第 ${index + 1} 张商品图`}
                    >
                      {PRODUCT_ORDER_MARKERS[index]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[9px]">
                      {typeof product?.data?.name === "string" &&
                      product.data.name
                        ? product.data.name
                        : `商品图 ${index + 1}`}
                    </span>
                    <div className="w-[108px] shrink-0">
                      <InlineSelect
                        value={binding?.partName ?? ""}
                        options={partOptions}
                        ariaLabel={`为商品图 ${index + 1} 选择部件`}
                        onChange={(partName) =>
                          setBinding(product?.id ?? "", partName)
                        }
                        stopCanvasGesture={stopCanvasGesture}
                        menuClassName="min-w-[132px]"
                        menuPlacement="bottom"
                        density="compact"
                        appearance="ghost"
                        disabled={!parts.length}
                      />
                    </div>
                  </div>
                );
              })}
              {!products.length && (
                <div className="flex h-12 items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-subtle)] text-[9px] text-[var(--text-muted)]">
                  <ImagePlus className="h-3.5 w-3.5" />
                  连接商品参考图
                </div>
              )}
            </div>
          </section>

          <textarea
            className="nodrag nopan min-h-16 resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--control-bg)] p-2 text-[10px] outline-none"
            maxLength={MAX_REFURNISH_REQUIREMENTS}
            value={data.requirements}
            placeholder="补充要求（可选）"
            onChange={(event) =>
              updateNodeData(id, { requirements: event.target.value })
            }
          />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <NodeModelSelector
              category="image"
              config={config}
              selection={imageSelection}
              onSelectModel={(model) =>
                updateNodeData(id, { model, errorMsg: "" })
              }
              stopCanvasGesture={stopCanvasGesture}
              providerAriaLabel="选择图片服务商"
              modelAriaLabel="选择图片模型"
              layout="grouped"
            />
            <div className="w-[72px] shrink-0">
              <InlineSelect
                value={data.resolution}
                options={resolutionOptions}
                ariaLabel="选择输出分辨率"
                onChange={(resolution) => updateNodeData(id, { resolution })}
                stopCanvasGesture={stopCanvasGesture}
                menuClassName="min-w-[88px]"
                menuPlacement="top"
              />
            </div>
          </div>
          {data.errorMsg && (
            <p className="text-[9px] text-red-500">{data.errorMsg}</p>
          )}
          <button
            type="button"
            className="nodrag nopan flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--accent-violet)] text-[11px] font-semibold text-white transition hover:bg-[var(--accent-violet-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-violet-soft)] disabled:opacity-45"
            disabled={
              isBusy ||
              !scene ||
              !data.bindings.length ||
              !imageSelection.canExecute
            }
            onClick={() => void runInteriorRefurnish(id)}
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : data.status === "done" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {data.status === "queued"
              ? "已进入队列"
              : data.status === "generating"
                ? "正在换装"
                : data.status === "done"
                  ? "再次生成"
                  : "开始生成"}
          </button>
        </div>
      </div>
    </div>
  );
});
