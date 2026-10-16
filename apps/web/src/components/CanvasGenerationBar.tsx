import { useEffect, useRef, useState } from "react";
import { Position } from "@xyflow/react";
import {
  ArrowUp,
  Clock3,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RotateCcw,
  Upload,
  Zap,
} from "lucide-react";
import { CanvasImagePreview } from "@/components/CanvasImagePreview";
import { StableNodeToolbar } from "@/components/StableNodeToolbar";
import { MAX_GENERATE_REFERENCE_IMAGES } from "@/constants/generateNode";
import { useGenerateNodeController } from "@/features/canvasGeneration/useGenerateNodeController";
import { importImageFile } from "@/features/imageImport/runtime";
import {
  RichPromptEditor,
  type RichPromptEditorHandle,
} from "@/features/richPrompt/RichPromptEditor";
import { NodeModelSelector } from "@/nodes/NodeModelSelector";
import { GenerationSettingsMenu } from "@/features/canvasGeneration/GenerationSettingsMenu";
import { ConnectedTextReference } from "@/features/canvasGeneration/ConnectedTextReference";
import { ImageReferenceCard } from "@/features/canvasGeneration/GenerationReferenceCard";
import { GenerationPromptDialog } from "@/features/canvasGeneration/GenerationPromptDialog";
import { selectSingleSelectedGenerateNode } from "@/store/canvasStoreSelectors";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useFeedbackStore } from "@/store/useFeedbackStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  getGenerateReferenceSourceNodes,
  isConnectedImageSourceNode,
} from "@/store/canvasConnectionSources";
import { themeClasses } from "@/styles/themeClasses";
import type { AppNode } from "@/types";

export function CanvasGenerationBar() {
  const node = useCanvasStore(selectSingleSelectedGenerateNode);
  return node ? (
    <StableNodeToolbar
      key={node.id}
      nodeId={node.id}
      position={Position.Bottom}
      offset={12}
      isVisible
      hideWhenNodeOffscreen
      hideWhenNodeDragging
      className="nodrag nopan nowheel"
    >
      <GeneratePanel node={node} />
    </StableNodeToolbar>
  ) : null;
}

function GeneratePanel({ node }: { node: AppNode<"generateNode"> }) {
  const controller = useGenerateNodeController({
    id: node.id,
    data: node.data,
  });
  const nodes = useCanvasStore((state) => state.nodes);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const referencePickerRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const promptEditorRef = useRef<RichPromptEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const runTracked = useHistoryStore((state) => state.runTracked);
  const notify = useFeedbackStore((state) => state.notify);
  useEffect(() => {
    if (!referencesOpen) return;
    const close = (event: PointerEvent) => {
      if (!referencePickerRef.current?.contains(event.target as Node))
        setReferencesOpen(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReferencesOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", keyDown);
    };
  }, [referencesOpen]);
  const availableImages = nodes.filter(
    (candidate) =>
      candidate.id !== node.id &&
      candidate.data.sourceGenerateNodeId !== node.id &&
      isConnectedImageSourceNode(candidate) &&
      !controller.referenceImages.some(
        (image) => image.sourceId === candidate.id,
      ),
  );
  const connectImage = (sourceId: string) => {
    if (controller.hasReferenceLimit) return;
    const store = useCanvasStore.getState();
    const source = store.nodes.find((candidate) => candidate.id === sourceId);
    if (
      !isConnectedImageSourceNode(source) ||
      source.id === node.id ||
      !store.nodes.some(
        (candidate) =>
          candidate.id === node.id && candidate.type === "generateNode",
      ) ||
      getGenerateReferenceSourceNodes(store.nodes, node.id).length >=
        MAX_GENERATE_REFERENCE_IMAGES
    )
      return;
    runTracked(() =>
      store.onConnect({
        source: sourceId,
        sourceHandle: [
          "generateNode",
          "entourageNode",
          "interiorRefurnishNode",
        ].includes(source.type ?? "")
          ? "image"
          : "output",
        target: node.id,
        targetHandle: "prompt",
      }),
    );
    setReferencesOpen(false);
  };
  const uploadReference = async (file: File) => {
    if (!file.type.startsWith("image/") || uploadingRef.current) return;
    const projectId = useProjectStore.getState().activeProjectId;
    uploadingRef.current = true;
    setUploading(true);
    try {
      const image = await importImageFile(
        file,
        useSettingsStore.getState().runtime.workspaceConfigured,
        projectId,
      );
      const store = useCanvasStore.getState();
      const target = store.nodes.find(
        (candidate) =>
          candidate.id === node.id && candidate.type === "generateNode",
      );
      if (
        useProjectStore.getState().activeProjectId !== projectId ||
        !target ||
        getGenerateReferenceSourceNodes(store.nodes, node.id).length >=
          MAX_GENERATE_REFERENCE_IMAGES
      )
        return;
      runTracked(() => {
        const sourceId = store.addImageNode({
          x: target.position.x - image.width - 80,
          y: target.position.y,
        });
        store.updateNodeData(sourceId, {
          imageUrl: image.imageUrl,
          imageAsset: image.imageAsset,
          name: image.name,
          imageNaturalWidth: image.naturalWidth,
          imageNaturalHeight: image.naturalHeight,
          width: image.width,
          height: image.height,
        });
        store.onConnect({
          source: sourceId,
          sourceHandle: "output",
          target: node.id,
          targetHandle: "prompt",
        });
        store.onNodesChange([
          { type: "select", id: sourceId, selected: false },
          { type: "select", id: node.id, selected: true },
        ]);
      });
      setReferencesOpen(false);
    } catch (error) {
      notify({
        tone: "error",
        title: "参考图上传失败",
        message: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };
  const buttonLabel = controller.isQueued
    ? "排队中"
    : controller.isGenerating
      ? "生成中"
      : node.data.status === "error"
        ? "重试生成"
        : "生成图片";
  const issue =
    node.data.status === "error" && node.data.errorMsg
      ? node.data.errorMsg
      : !controller.modelSelection.canExecute &&
          controller.modelSelection.issue !== "unbound"
        ? controller.modelIssueLabel || "请先选择可用的图像模型"
        : "";
  const closePromptEditor = () => {
    controller.handlePromptBlur();
    setReferencesOpen(false);
    setPromptExpanded(false);
    window.requestAnimationFrame(() =>
      expandButtonRef.current?.focus({ preventScroll: true }),
    );
  };
  const panel = (
    <section
      data-testid="canvas-generation-bar"
      data-node-id={node.id}
      data-expanded={promptExpanded}
      aria-label="图片生成面板"
      className={`canvas-generation-panel flex flex-col rounded-2xl border border-[var(--floating-panel-border)] bg-[var(--floating-panel-bg)] text-[var(--text-primary)] shadow-[0_8px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl ${promptExpanded ? "h-full w-full p-3 sm:p-4" : "h-[246px] max-h-[70dvh] w-[658px] max-w-[calc(100vw-24px)] p-3"}`}
      onPointerDown={controller.stopCanvasGesture}
      onMouseDown={controller.stopCanvasGesture}
      onClick={controller.stopCanvasGesture}
      onKeyDown={(event) => {
        if (!promptExpanded || (event.key !== "Tab" && event.key !== "Escape"))
          event.stopPropagation();
      }}
    >
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <div
          ref={referencePickerRef}
          className="relative"
          onKeyDown={(event) => {
            if (event.key === "Escape" && referencesOpen) {
              event.stopPropagation();
              setReferencesOpen(false);
            }
          }}
        >
          <button
            type="button"
            aria-label="添加参考图"
            aria-expanded={referencesOpen}
            aria-haspopup="dialog"
            disabled={controller.hasReferenceLimit}
            onClick={() => setReferencesOpen((open) => !open)}
            className={`${themeClasses.iconButton} h-7 gap-1 rounded-full bg-[var(--control-bg-hover)] px-2.5 text-[11px] disabled:opacity-40`}
          >
            <Plus className="h-3.5 w-3.5" />
            参考
            {controller.referenceImageCount
              ? ` ${controller.referenceImageCount}`
              : ""}
          </button>
          {referencesOpen ? (
            <div
              role="dialog"
              aria-label="添加参考图"
              className={`absolute left-0 top-full z-20 mt-2 w-64 max-w-[calc(100vw-3rem)] p-2 ${themeClasses.compactFloatingPanel}`}
            >
              <button
                type="button"
                disabled={uploading}
                className={`${themeClasses.iconButton} mb-2 h-8 w-full gap-2 text-xs`}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                上传参考图
              </button>
              <div className="max-h-44 overflow-y-auto">
                {availableImages.length ? (
                  availableImages.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => connectImage(image.id)}
                      className={`${themeClasses.iconButton} flex h-12 w-full justify-start gap-2 px-2 text-xs`}
                    >
                      <CanvasImagePreview
                        src={String(image.data.imageUrl)}
                        imageAsset={
                          image.data
                            .imageAsset as AppNode<"imageNode">["data"]["imageAsset"]
                        }
                        alt="画布图片"
                        className="h-9 w-9 rounded object-cover"
                        forceLowQualityPreview
                      />
                      <span className="min-w-0 truncate">
                        {String(
                          image.data.name || image.data.label || "画布图片",
                        )}
                      </span>
                    </button>
                  ))
                ) : (
                  <p
                    className={`px-2 py-3 text-[11px] ${themeClasses.textMuted}`}
                  >
                    上传图片，或将画布中的图片连入左侧连接口
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="上传参考图文件"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadReference(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          aria-label={
            controller.maskInputEnabled ? "关闭蒙版输入" : "开启蒙版输入"
          }
          aria-pressed={controller.maskInputEnabled}
          onClick={controller.toggleMaskInput}
          className={`${themeClasses.iconButton} h-7 rounded-full px-2.5 text-[11px] ${controller.maskInputEnabled ? "bg-amber-400/10 text-amber-600 dark:text-amber-300" : ""}`}
        >
          蒙版
        </button>
        {controller.hasReferenceLimit ? (
          <span className={`text-[10px] ${themeClasses.textMuted}`}>
            最多 {MAX_GENERATE_REFERENCE_IMAGES} 张参考图
          </span>
        ) : null}
        <button
          ref={expandButtonRef}
          type="button"
          aria-label={promptExpanded ? "收起生成面板" : "放大编辑提示词"}
          title={promptExpanded ? "收起生成面板（Esc）" : "放大编辑提示词"}
          aria-haspopup={promptExpanded ? undefined : "dialog"}
          aria-expanded={promptExpanded}
          data-testid="expand-generation-prompt"
          onClick={() => {
            if (promptExpanded) {
              closePromptEditor();
              return;
            }
            controller.handlePromptBlur();
            setReferencesOpen(false);
            setPromptExpanded(true);
          }}
          className={`${themeClasses.iconButton} ml-auto h-7 w-7 shrink-0`}
        >
          {promptExpanded ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {controller.connectedText.sourceId ||
        controller.referenceImages.length ||
        controller.maskSourceImage ? (
          <div className="mb-2 flex shrink-0 flex-wrap gap-2">
            {controller.connectedText.sourceId ? (
              <ConnectedTextReference
                text={controller.connectedText.text}
                onDisconnect={controller.removeTextReference}
              />
            ) : null}
            {controller.referenceImages.map((image, index) => (
              <ImageReferenceCard
                key={image.sourceId}
                image={image}
                order={index + 1}
                onDisconnect={() => controller.removeReference(image.sourceId)}
                disconnectTestId={`disconnect-reference-${image.sourceId}-${node.id}`}
                onMention={() => {
                  const reference = controller.richPromptReferences.find(
                    (candidate) => candidate.sourceId === image.sourceId,
                  );
                  if (reference)
                    promptEditorRef.current?.insertReference(reference);
                }}
              />
            ))}
            {controller.maskImageUrl && controller.maskSourceImage ? (
              <ImageReferenceCard
                image={controller.maskSourceImage}
                onDisconnect={controller.removeMask}
                isMask
              />
            ) : null}
          </div>
        ) : null}
        <div
          className="flex min-h-0 flex-1 overflow-hidden overscroll-contain"
          data-testid="generation-prompt-editor"
        >
          <RichPromptEditor
            ref={promptEditorRef}
            key={controller.isConnected ? "supplement" : "prompt"}
            value={controller.editablePrompt.richPrompt}
            fallbackText={controller.editablePrompt.prompt}
            references={controller.richPromptReferences}
            placeholder={
              controller.isConnected
                ? "添加补充描述，将追加在连接的文本后，例如：将背景改为雪夜"
                : "可直接文字生图，或添加参考图输入指令编辑，例如：将背景改为雪夜"
            }
            readOnly={false}
            minHeightClassName={promptExpanded ? "min-h-0" : "min-h-[88px]"}
            appearance="plain"
            onFocus={controller.beginPromptTransaction}
            onChange={controller.handlePromptChange}
            onBlur={controller.handlePromptBlur}
          />
        </div>
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1">
        <NodeModelSelector
          category="image"
          config={controller.settingsConfig}
          selection={controller.modelSelection}
          onSelectModel={controller.selectModel}
          stopCanvasGesture={controller.stopCanvasGesture}
          providerAriaLabel="选择图像服务商"
          modelAriaLabel="选择图像模型和服务商"
          layout="grouped"
          appearance="ghost"
          menuPlacement="top"
          className="w-72 max-w-full shrink-0"
          menuClassName="min-w-full max-w-[calc(100vw-3rem)]"
          resolution={controller.resolution}
        />
        <span className={`mx-1 h-4 w-px ${themeClasses.divider}`} />
        <GenerationSettingsMenu controller={controller} />
        <div className="ml-auto flex shrink-0 items-center gap-4">
          {controller.creditCost !== null ? (
            <span
              data-testid="generation-credit-cost"
              aria-label={`预计消耗 ${controller.creditCost} 算力`}
              title={`本次生成预计消耗 ${controller.creditCost} 算力`}
              className={`inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums ${themeClasses.textSecondary}`}
            >
              <Zap className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              {controller.creditCost.toLocaleString("zh-CN")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={controller.enqueue}
            disabled={
              !controller.hasPrompt || !controller.modelSelection.canExecute
            }
            data-testid={`enqueue-generate-${node.id}`}
            aria-label={buttonLabel}
            title={buttonLabel}
            className={`${themeClasses.nodePrimaryButton} h-8 w-8 shrink-0`}
          >
            {controller.isQueued ? (
              <Clock3 className="h-4 w-4" />
            ) : controller.isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : node.data.status === "error" ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      {controller.isBusy || issue ? (
        <p
          role="status"
          className={`mt-2 text-[10px] leading-4 ${issue ? themeClasses.nodeWarningText : themeClasses.textMuted}`}
        >
          {issue ||
            `${controller.isQueued ? "已加入队列" : "图片生成中"}${controller.activeTaskCount > 1 ? ` · ${controller.activeTaskCount} 项任务` : ""}`}
        </p>
      ) : null}
    </section>
  );
  return promptExpanded ? (
    <GenerationPromptDialog onClose={closePromptEditor}>
      {panel}
    </GenerationPromptDialog>
  ) : (
    panel
  );
}
