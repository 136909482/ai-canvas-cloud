import { memo, useEffect, useRef, useState } from "react";
import { ImageOff, RefreshCw } from "lucide-react";
import { useCanvasPerformanceContext } from "@/components/CanvasPerformanceContext";
import {
  cacheThumbnail,
  decodeImageSource,
  getCachedThumbnailUrl,
  isAbortError,
  isDirectThumbnailUrl,
  loadThumbnail,
  scheduleIdleTask,
} from "@/components/canvasImagePreviewRuntime";
import { restoreWorkspaceImageThumbnailAsset } from "@/features/imageAssets/runtime";
import { platformBridge } from "@/platform";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { WorkspaceImageAsset } from "@/types";
import { recordComponentRender } from "@/utils/performanceDiagnostics";

type CanvasImagePreviewProps = {
  src: string;
  alt: string;
  imageAsset?: Partial<
    Pick<
      WorkspaceImageAsset,
      | "relativePath"
      | "fileName"
      | "thumbnailRelativePath"
      | "originalWidth"
      | "originalHeight"
      | "projectId"
    >
  > | null;
  className?: string;
  draggable?: boolean;
  forceLowQualityPreview?: boolean;
};

export const CanvasImagePreview = memo(function CanvasImagePreview({
  src,
  alt,
  imageAsset = null,
  className = "",
  draggable = false,
  forceLowQualityPreview = false,
}: CanvasImagePreviewProps) {
  recordComponentRender("CanvasImagePreview");
  const highQualityPreviewEnabled = useSettingsStore(
    (state) => state.config.storage.lowQualityPreviewEnabled,
  );
  const canvasPerformanceMode = useSettingsStore(
    (state) => state.config.storage.canvasPerformanceMode,
  );
  const { forceLowQualityImages, imagePreviewQuality } =
    useCanvasPerformanceContext();
  const shouldUseLowQualityPreview =
    forceLowQualityPreview ||
    forceLowQualityImages ||
    imagePreviewQuality === "thumbnail" ||
    canvasPerformanceMode === "performance" ||
    !highQualityPreviewEnabled;

  return (
    <CanvasImagePreviewInner
      src={src}
      alt={alt}
      imageAsset={imageAsset}
      className={className}
      draggable={draggable}
      shouldUseLowQualityPreview={shouldUseLowQualityPreview}
    />
  );
});

type CanvasImagePreviewInnerProps = CanvasImagePreviewProps & {
  shouldUseLowQualityPreview: boolean;
};

function CanvasImagePreviewInner({
  src,
  alt,
  imageAsset = null,
  className = "",
  draggable = false,
  shouldUseLowQualityPreview,
}: CanvasImagePreviewInnerProps) {
  recordComponentRender("CanvasImagePreviewInner");
  const imageElementRef = useRef<HTMLImageElement>(null);
  const automaticRecoveryKeyRef = useRef("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isNearViewport, setIsNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const persistentOriginalRelativePath =
    typeof imageAsset?.relativePath === "string" ? imageAsset.relativePath : "";
  const persistentThumbnailRelativePath =
    typeof imageAsset?.thumbnailRelativePath === "string"
      ? imageAsset.thumbnailRelativePath
      : "";
  const directPersistentThumbnailSrc =
    persistentThumbnailRelativePath &&
    isDirectThumbnailUrl(persistentThumbnailRelativePath)
      ? persistentThumbnailRelativePath
      : null;
  const [persistentThumbnailState, setPersistentThumbnailState] = useState<{
    path: string;
    url: string | null;
    unavailable: boolean;
  }>(() => ({
    path: persistentThumbnailRelativePath,
    url: directPersistentThumbnailSrc,
    unavailable: false,
  }));
  const [persistentOriginalState, setPersistentOriginalState] = useState<{
    path: string;
    url: string | null;
  }>(() => ({ path: persistentOriginalRelativePath, url: null }));
  const [runtimeThumbnailState, setRuntimeThumbnailState] = useState<{
    source: string;
    url: string | null;
  }>(() => ({ source: src, url: getCachedThumbnailUrl(src) }));
  const persistentThumbnailSrc =
    directPersistentThumbnailSrc ??
    (persistentThumbnailState.path === persistentThumbnailRelativePath
      ? persistentThumbnailState.url
      : null);
  const persistentThumbnailUnavailable =
    Boolean(persistentThumbnailRelativePath) &&
    !directPersistentThumbnailSrc &&
    persistentThumbnailState.path === persistentThumbnailRelativePath &&
    persistentThumbnailState.unavailable;
  const shouldResolvePersistentOriginal =
    !shouldUseLowQualityPreview ||
    !persistentThumbnailRelativePath ||
    persistentThumbnailUnavailable;
  const persistentOriginalSrc =
    persistentOriginalState.path === persistentOriginalRelativePath
      ? persistentOriginalState.url
      : null;
  const runtimeThumbnailSource = persistentOriginalSrc ?? src;
  const runtimeThumbnailSrc =
    runtimeThumbnailState.source === runtimeThumbnailSource
      ? runtimeThumbnailState.url
      : getCachedThumbnailUrl(runtimeThumbnailSource);
  const desiredSourceSrc = shouldUseLowQualityPreview
    ? (persistentThumbnailSrc ??
      (runtimeThumbnailSrc !== runtimeThumbnailSource
        ? runtimeThumbnailSrc
        : null) ??
      persistentOriginalSrc ??
      src)
    : (persistentOriginalSrc ?? src);
  const desiredSourceType =
    shouldUseLowQualityPreview && persistentThumbnailSrc
      ? "workspace-thumbnail"
      : shouldUseLowQualityPreview &&
          runtimeThumbnailSrc &&
          runtimeThumbnailSrc !== runtimeThumbnailSource
        ? "runtime-thumbnail"
        : persistentOriginalSrc && desiredSourceSrc === persistentOriginalSrc
          ? "workspace-original"
          : "original";
  const [renderedSource, setRenderedSource] = useState<{
    src: string;
    type:
      | "original"
      | "workspace-original"
      | "workspace-thumbnail"
      | "runtime-thumbnail";
  }>(() => ({ src, type: "original" }));
  const renderedSourceKey = `${renderedSource.src}\u0000${loadAttempt}`;
  const [renderState, setRenderState] = useState<{
    key: string;
    status: "loading" | "ready" | "error";
  }>(() => ({ key: renderedSourceKey, status: "loading" }));
  const activeRenderStatus =
    renderState.key === renderedSourceKey ? renderState.status : "loading";

  useEffect(() => {
    if (isNearViewport) return;
    const element = imageElementRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setIsNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isNearViewport]);

  useEffect(() => {
    if (
      !persistentOriginalRelativePath ||
      !shouldResolvePersistentOriginal ||
      !isNearViewport
    ) {
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setPersistentOriginalState({
      path: persistentOriginalRelativePath,
      url: null,
    });

    void platformBridge
      .loadWorkspaceAssetBlob(persistentOriginalRelativePath)
      .then((blob) => {
        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setPersistentOriginalState({
          path: persistentOriginalRelativePath,
          url: nextObjectUrl,
        });
      })
      .catch(async () => {
        try {
          platformBridge.clearWorkspaceAssetUrlCache();
          const refreshedUrl = await platformBridge.resolveWorkspaceAssetUrl(
            persistentOriginalRelativePath,
          );
          if (!cancelled) {
            setPersistentOriginalState({
              path: persistentOriginalRelativePath,
              url: refreshedUrl,
            });
          }
        } catch {
          // The rendered image error state provides the final retry action.
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    isNearViewport,
    loadAttempt,
    persistentOriginalRelativePath,
    shouldResolvePersistentOriginal,
  ]);

  useEffect(() => {
    if (
      !persistentThumbnailRelativePath ||
      !shouldUseLowQualityPreview ||
      !isNearViewport ||
      isDirectThumbnailUrl(persistentThumbnailRelativePath)
    ) {
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setPersistentThumbnailState({
      path: persistentThumbnailRelativePath,
      url: null,
      unavailable: false,
    });
    const resolvePersistentThumbnail = async () => {
      try {
        const blob = await platformBridge.loadWorkspaceAssetBlob(
          persistentThumbnailRelativePath,
        );
        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setPersistentThumbnailState({
          path: persistentThumbnailRelativePath,
          url: nextObjectUrl,
          unavailable: false,
        });
      } catch {
        if (imageAsset?.relativePath && imageAsset.fileName) {
          try {
            await restoreWorkspaceImageThumbnailAsset({
              asset: {
                relativePath: imageAsset.relativePath,
                fileName: imageAsset.fileName,
                thumbnailRelativePath: persistentThumbnailRelativePath,
                originalWidth: imageAsset.originalWidth,
                originalHeight: imageAsset.originalHeight,
                projectId: imageAsset.projectId,
              },
              imageUrl: src,
            });
            const restoredBlob = await platformBridge.loadWorkspaceAssetBlob(
              persistentThumbnailRelativePath,
            );
            const nextObjectUrl = URL.createObjectURL(restoredBlob);
            if (cancelled) {
              URL.revokeObjectURL(nextObjectUrl);
              return;
            }
            objectUrl = nextObjectUrl;
            setPersistentThumbnailState({
              path: persistentThumbnailRelativePath,
              url: nextObjectUrl,
              unavailable: false,
            });
            return;
          } catch {
            // Fall back to the runtime thumbnail path below.
          }
        }

        if (!cancelled) {
          setPersistentThumbnailState({
            path: persistentThumbnailRelativePath,
            url: null,
            unavailable: true,
          });
        }
      }
    };

    void resolvePersistentThumbnail();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    imageAsset?.fileName,
    imageAsset?.originalHeight,
    imageAsset?.originalWidth,
    imageAsset?.projectId,
    imageAsset?.relativePath,
    persistentThumbnailRelativePath,
    isNearViewport,
    loadAttempt,
    shouldUseLowQualityPreview,
    src,
  ]);

  useEffect(() => {
    if (
      !runtimeThumbnailSource ||
      !shouldUseLowQualityPreview ||
      !isNearViewport ||
      getCachedThumbnailUrl(runtimeThumbnailSource) ||
      (persistentThumbnailRelativePath && !persistentThumbnailUnavailable)
    ) {
      return;
    }

    let cancelled = false;
    const cancelIdleTask = scheduleIdleTask(() => {
      void loadThumbnail(runtimeThumbnailSource)
        .then((nextThumbnailSrc) => {
          if (cancelled) {
            return;
          }

          setRuntimeThumbnailState({
            source: runtimeThumbnailSource,
            url: nextThumbnailSrc,
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          if (isAbortError(error)) {
            return;
          }

          cacheThumbnail(runtimeThumbnailSource, runtimeThumbnailSource);
          setRuntimeThumbnailState({
            source: runtimeThumbnailSource,
            url: runtimeThumbnailSource,
          });
        });
    });

    return () => {
      cancelled = true;
      cancelIdleTask();
    };
  }, [
    isNearViewport,
    persistentThumbnailRelativePath,
    persistentThumbnailUnavailable,
    runtimeThumbnailSource,
    shouldUseLowQualityPreview,
  ]);

  useEffect(() => {
    if (
      !desiredSourceSrc ||
      (renderedSource.src === desiredSourceSrc &&
        renderedSource.type === desiredSourceType)
    ) {
      return;
    }

    let cancelled = false;
    void decodeImageSource(desiredSourceSrc, {
      serialized: desiredSourceType !== renderedSource.type,
    })
      .then(() => {
        if (!cancelled) {
          setRenderedSource({ src: desiredSourceSrc, type: desiredSourceType });
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    desiredSourceSrc,
    desiredSourceType,
    renderedSource.src,
    renderedSource.type,
  ]);

  const isLowQualitySource =
    renderedSource.type === "workspace-thumbnail" ||
    renderedSource.type === "runtime-thumbnail";

  const retryImageLoad = () => {
    platformBridge.clearWorkspaceAssetUrlCache();
    setIsNearViewport(true);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const handleImageError = () => {
    setIsNearViewport(true);
    const recoveryKey = `${src}\u0000${persistentOriginalRelativePath}\u0000${persistentThumbnailRelativePath}`;
    const canRecoverFromWorkspaceAsset = Boolean(
      persistentOriginalRelativePath || persistentThumbnailRelativePath,
    );

    if (
      canRecoverFromWorkspaceAsset &&
      automaticRecoveryKeyRef.current !== recoveryKey
    ) {
      automaticRecoveryKeyRef.current = recoveryKey;
      retryImageLoad();
      return;
    }

    setRenderState({ key: renderedSourceKey, status: "error" });
  };

  const wrapperPosition = className.split(/\s+/).includes("absolute")
    ? "absolute"
    : "relative";

  return (
    <span
      className={`block overflow-hidden ${className}`}
      style={{ position: wrapperPosition }}
      data-canvas-image-preview="true"
    >
      {activeRenderStatus !== "error" ? (
        <img
          key={renderedSourceKey}
          ref={imageElementRef}
          src={renderedSource.src}
          alt={alt}
          className={`absolute inset-0 h-full w-full rounded-[inherit] transition-opacity duration-150 ${
            activeRenderStatus === "ready" ? "opacity-100" : "opacity-0"
          }`}
          style={{ objectFit: "inherit" }}
          draggable={draggable}
          loading="lazy"
          decoding="async"
          onLoad={() =>
            setRenderState({ key: renderedSourceKey, status: "ready" })
          }
          onError={handleImageError}
          data-canvas-image-source={renderedSource.type}
          data-low-quality-preview={isLowQualitySource ? "true" : undefined}
          data-workspace-thumbnail-preview={
            renderedSource.type === "workspace-thumbnail" ? "true" : undefined
          }
          data-workspace-original-preview={
            renderedSource.type === "workspace-original" ? "true" : undefined
          }
        />
      ) : null}

      {activeRenderStatus === "error" ? (
        <span
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--node-bg)] px-4 text-center text-[var(--text-secondary)]"
          role="img"
          aria-label={alt ? `${alt}：图片加载失败` : "图片加载失败"}
          data-canvas-image-error="true"
        >
          <ImageOff className="h-5 w-5 opacity-60" aria-hidden="true" />
          <span className="max-w-full truncate text-xs">图片加载失败</span>
          <button
            type="button"
            className="nodrag nopan flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] transition hover:border-[var(--border-default)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/30"
            onClick={(event) => {
              event.stopPropagation();
              retryImageLoad();
            }}
            aria-label="重新加载图片"
            title="重新加载图片"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </span>
  );
}
