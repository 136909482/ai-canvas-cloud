import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Maximize,
  Send,
  Upload,
} from "lucide-react";
import { CanvasImagePreview } from "@/components/CanvasImagePreview";
import { StableNodeToolbar } from "@/components/StableNodeToolbar";
import { ZoomableImagePreview } from "@/components/ZoomableImagePreview";
import {
  buildUploadedImageGraph,
  getGeneratedImageCardSize,
} from "@/features/canvasGeneration/imageNodePresentation";
import { ImageGenerationOverlay } from "@/features/canvasGeneration/ImageGenerationOverlay";
import { loadImageDimensions } from "@/features/generateQueue/previewUtils";
import { CommunitySubmissionDialog } from "@/features/community/CommunitySubmissionDialog";
import { importImageFile } from "@/features/imageImport/runtime";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useFeedbackStore } from "@/store/useFeedbackStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { themeClasses } from "@/styles/themeClasses";
import type { AppNodeProps } from "@/types";
import { recordComponentRender } from "@/utils/performanceDiagnostics";
import { downloadCanvasImage } from "@/utils/downloadCanvasImage";
import { NodeDeleteButton, NodeHeader, NodeResizerPreset } from "../nodeShell";
import { getNodeShellClassName } from "../nodeShellClassName";
import { areNodeContentPropsEqual } from "../nodePropComparators";
import styles from "./ImageNodeEmptyState.module.css";

// The existing generation node is presented as an image card; its task/data
// contract stays intact and completed images already come back to imageUrl.
export const GenerateNode = memo(function GenerateNode({
  id,
  data,
  selected,
  dragging,
}: AppNodeProps<"generateNode">) {
  recordComponentRender("GenerateNode");
  const isQueued = data.status === "queued";
  const isGenerating = data.status === "generating";
  const isBusy = isQueued || isGenerating;
  const isResizing = useCanvasStore((state) =>
    Boolean(state.nodes.find((node) => node.id === id)?.resizing),
  );
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const runTracked = useHistoryStore((state) => state.runTracked);
  const notify = useFeedbackStore((state) => state.notify);
  const updateNodeInternals = useUpdateNodeInternals();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showCommunitySubmission, setShowCommunitySubmission] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({
    imageUrl: "",
    width: 0,
    height: 0,
  });
  const hasImageDimensions =
    Boolean(data.imageUrl) &&
    imageDimensions.imageUrl === data.imageUrl &&
    imageDimensions.width > 0 &&
    imageDimensions.height > 0;
  const handleSaveImage = async () => {
    if (!data.imageUrl || isSavingImage) return;
    setIsSavingImage(true);
    try {
      await downloadCanvasImage({
        imageUrl: data.imageUrl,
        imageAsset: data.imageAsset,
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "图片下载失败",
        message: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setIsSavingImage(false);
    }
  };
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data.maskInputEnabled, updateNodeInternals]);
  useEffect(() => {
    const imageUrl = data.imageUrl;
    if (!imageUrl || isBusy || dragging || isResizing) return;
    let cancelled = false;
    const projectId = useProjectStore.getState().activeProjectId;
    const fitImage = ({ width, height }: { width: number; height: number }) => {
      if (cancelled || useProjectStore.getState().activeProjectId !== projectId)
        return;
      const store = useCanvasStore.getState();
      const node = store.nodes.find((candidate) => candidate.id === id);
      if (
        !node ||
        node.type !== "generateNode" ||
        node.data.imageUrl !== imageUrl ||
        node.resizing ||
        node.data.status === "queued" ||
        node.data.status === "generating"
      )
        return;
      const size = getGeneratedImageCardSize(width, height, node.width);
      if (!size) return;
      setImageDimensions((current) =>
        current.imageUrl === imageUrl &&
        current.width === width &&
        current.height === height
          ? current
          : { imageUrl, width, height },
      );
      if (node.width === size.width && node.height === size.height) return;
      store.updateNodeData(id, size);
    };
    const width =
      data.imageAsset?.originalWidth ?? data.imageAsset?.displayWidth;
    const height =
      data.imageAsset?.originalHeight ?? data.imageAsset?.displayHeight;
    if (
      width &&
      height &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      fitImage({ width, height });
    } else {
      void loadImageDimensions(imageUrl)
        .then(fitImage)
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [
    id,
    data.imageUrl,
    data.imageAsset?.originalWidth,
    data.imageAsset?.originalHeight,
    data.imageAsset?.displayWidth,
    data.imageAsset?.displayHeight,
    isBusy,
    dragging,
    isResizing,
  ]);
  const handleFile = useCallback(
    async (file: File) => {
      const current = useCanvasStore
        .getState()
        .nodes.find((node) => node.id === id);
      if (
        !file.type.startsWith("image/") ||
        uploadingRef.current ||
        !current ||
        current.type !== "generateNode" ||
        current.data.imageUrl ||
        current.data.status === "queued" ||
        current.data.status === "generating"
      )
        return;
      const projectId = useProjectStore.getState().activeProjectId;
      uploadingRef.current = true;
      setUploading(true);
      try {
        const image = await importImageFile(
          file,
          useSettingsStore.getState().runtime.workspaceConfigured,
          projectId,
        );
        if (useProjectStore.getState().activeProjectId !== projectId) return;
        const store = useCanvasStore.getState();
        const nextGraph = buildUploadedImageGraph(
          store.nodes,
          store.edges,
          id,
          image,
        );
        if (nextGraph) runTracked(() => useCanvasStore.setState(nextGraph));
      } catch (error) {
        notify({
          tone: "error",
          title: "图片上传失败",
          message: error instanceof Error ? error.message : "请稍后重试",
        });
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [id, notify, runTracked],
  );
  useEffect(() => {
    if (!selected || data.imageUrl || isBusy) return;
    const paste = (event: ClipboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable="true"]')
      )
        return;
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        void handleFile(file);
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [isBusy, data.imageUrl, handleFile, selected]);
  return (
    <>
      {selected ? (
        <StableNodeToolbar
          position={Position.Top}
          offset={10}
          hideWhenNodeOffscreen
          hideWhenNodeDragging
          data-testid={`image-actions-toolbar-${id}`}
        >
          <div
            role="toolbar"
            aria-label="图片节点快捷操作"
            className={`nodrag nopan flex items-center gap-1 p-[5px] ${themeClasses.nodeToolbarPanel}`}
          >
            {data.imageUrl ? (
              <>
                <button
                  type="button"
                  onClick={handleSaveImage}
                  disabled={isSavingImage}
                  className={`${themeClasses.nodeToolbarButton} h-7 w-7`}
                  aria-label="下载图片"
                  title="下载图片"
                >
                  {isSavingImage ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </button>
                {data.imageAsset?.assetId ? (
                  <button
                    type="button"
                    onClick={() => setShowCommunitySubmission(true)}
                    className={`${themeClasses.nodeToolbarButton} h-7 w-7`}
                    aria-label="投稿社区"
                    title="投稿社区"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className={`${themeClasses.nodeToolbarButton} h-7 w-7`}
                  aria-label="放大预览"
                  title="放大预览"
                >
                  <Maximize className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isBusy}
                className={`${themeClasses.nodeToolbarButton} h-7 w-7`}
                aria-label="上传图片素材"
                title="上传图片素材"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </StableNodeToolbar>
      ) : null}
      <div
        data-testid={`node-${id}`}
        className={getNodeShellClassName({ selected })}
        onDragOver={(event) => {
          if (!data.imageUrl && !isBusy) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const file = event.dataTransfer.files[0];
          if (file && !data.imageUrl && !isBusy) void handleFile(file);
        }}
      >
        <NodeResizerPreset
          selected={selected}
          minWidth={data.imageUrl ? 100 : 240}
          minHeight={data.imageUrl ? 100 : 160}
          maxWidth={900}
          maxHeight={900}
          keepAspectRatio={Boolean(data.imageUrl)}
          hideVisuals
        />
        <NodeDeleteButton
          id={id}
          selected={selected}
          ariaLabel="删除图片节点"
          onDelete={() => runTracked(() => deleteNode(id))}
        />
        <NodeHeader
          variant="floating"
          constrainToNode
          icon={<ImageIcon />}
          title={data.imageAsset?.fileName?.trim() || "图片节点"}
          titleClassName="text-xs font-medium leading-5"
        />
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          aria-label="上传图片素材"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
        <Handle
          type="target"
          position={Position.Left}
          id="prompt"
          className="handle-orb-anchor !w-[18px] !h-[18px] !rounded-full !border-0 !bg-transparent !p-0"
        >
          <span className="handle-orb handle-orb--target">
            <span className="handle-orb__glow" />
            <span className="handle-orb__ring" />
            <span className="handle-orb__dot" />
          </span>
        </Handle>
        {data.maskInputEnabled ? (
          <Handle
            type="target"
            position={Position.Left}
            id="mask"
            aria-label="蒙版输入"
            style={{ top: "72%" }}
            className="handle-orb-anchor !w-[18px] !h-[18px] !rounded-full !border-0 !bg-transparent !p-0"
          >
            <span className="handle-orb handle-orb--mask">
              <span className="handle-orb__glow" />
              <span className="handle-orb__ring" />
              <span className="handle-orb__dot" />
            </span>
          </Handle>
        ) : null}
        <Handle
          type="source"
          position={Position.Right}
          id="image"
          className="handle-orb-anchor !w-[18px] !h-[18px] !rounded-full !border-0 !bg-transparent !p-0"
        >
          <span className="handle-orb handle-orb--source">
            <span className="handle-orb__glow" />
            <span className="handle-orb__ring" />
            <span className="handle-orb__dot" />
          </span>
        </Handle>
        <div
          className="node-drag-handle relative flex min-h-0 flex-1 cursor-grab overflow-hidden rounded-[7px] bg-[var(--node-bg)] active:cursor-grabbing"
          onDoubleClick={() => {
            if (data.imageUrl) setPreviewOpen(true);
          }}
        >
          {data.imageUrl ? (
            <CanvasImagePreview
              src={data.imageUrl}
              imageAsset={data.imageAsset}
              alt="生成图片"
              className="h-full w-full object-contain"
            />
          ) : !isBusy ? (
            <div className={styles.emptyState}>
              <ImageIcon className={styles.icon} aria-hidden="true" />
              <span className={styles.hint}>尝试上传或生成图片</span>
              <button
                type="button"
                className={`nodrag nopan ${styles.uploadButton}`}
                onClick={(event) => {
                  event.stopPropagation();
                  fileInputRef.current?.click();
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {uploading ? "上传中…" : "上传图片"}
              </button>
            </div>
          ) : null}
          {hasImageDimensions ? (
            <span
              data-testid={`image-dimensions-${id}`}
              className="pointer-events-none absolute bottom-3 right-3 select-none whitespace-nowrap rounded-md bg-black/50 px-2 py-1 text-[10px] font-medium leading-none text-white shadow-[0_4px_12px_rgba(0,0,0,0.22)] backdrop-blur-sm"
            >
              {imageDimensions.width} x {imageDimensions.height}
            </span>
          ) : null}
          {isBusy ? (
            <ImageGenerationOverlay
              taskId={data.activeTaskId}
              queued={isQueued}
            />
          ) : null}
          {data.status === "error" ? (
            <span
              role="status"
              className={`absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-[var(--panel-bg-strong)] px-2 py-1 text-[10px] ${themeClasses.nodeErrorText}`}
            >
              生成失败
            </span>
          ) : null}
        </div>
      </div>
      {previewOpen && data.imageUrl ? (
        <ZoomableImagePreview
          imageUrl={data.imageUrl}
          imageAsset={data.imageAsset}
          alt="生成图片"
          closeLabel="关闭预览"
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {showCommunitySubmission && data.imageAsset?.assetId && data.imageUrl ? (
        <CommunitySubmissionDialog
          assetId={data.imageAsset.assetId}
          imageUrl={data.imageUrl}
          defaultTitle={
            typeof data.label === "string" && data.label.trim()
              ? data.label
              : "生成图片"
          }
          onClose={() => setShowCommunitySubmission(false)}
        />
      ) : null}
    </>
  );
}, areNodeContentPropsEqual);
