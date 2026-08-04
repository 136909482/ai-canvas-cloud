import { memo, useEffect, useRef, useState } from "react";
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
  const runtimeThumbnailSrc =
    runtimeThumbnailState.source === src
      ? runtimeThumbnailState.url
      : getCachedThumbnailUrl(src);
  const persistentOriginalSrc =
    persistentOriginalState.path === persistentOriginalRelativePath
      ? persistentOriginalState.url
      : null;
  const desiredSourceSrc = shouldUseLowQualityPreview
    ? (persistentThumbnailSrc ?? runtimeThumbnailSrc ?? src)
    : (persistentOriginalSrc ?? src);
  const desiredSourceType =
    shouldUseLowQualityPreview && persistentThumbnailSrc
      ? "workspace-thumbnail"
      : shouldUseLowQualityPreview &&
          runtimeThumbnailSrc &&
          runtimeThumbnailSrc !== src
        ? "runtime-thumbnail"
        : !shouldUseLowQualityPreview && persistentOriginalSrc
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
      shouldUseLowQualityPreview ||
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
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    isNearViewport,
    persistentOriginalRelativePath,
    shouldUseLowQualityPreview,
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
    shouldUseLowQualityPreview,
    src,
  ]);

  useEffect(() => {
    if (
      !src ||
      !shouldUseLowQualityPreview ||
      !isNearViewport ||
      getCachedThumbnailUrl(src) ||
      (persistentThumbnailRelativePath && !persistentThumbnailUnavailable)
    ) {
      return;
    }

    let cancelled = false;
    const cancelIdleTask = scheduleIdleTask(() => {
      void loadThumbnail(src)
        .then((nextThumbnailSrc) => {
          if (cancelled) {
            return;
          }

          setRuntimeThumbnailState({ source: src, url: nextThumbnailSrc });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          if (isAbortError(error)) {
            return;
          }

          cacheThumbnail(src, src);
          setRuntimeThumbnailState({ source: src, url: src });
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
    shouldUseLowQualityPreview,
    src,
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

  return (
    <img
      ref={imageElementRef}
      src={renderedSource.src}
      alt={alt}
      className={className}
      draggable={draggable}
      loading="lazy"
      decoding="async"
      onError={() => setIsNearViewport(true)}
      data-canvas-image-source={renderedSource.type}
      data-low-quality-preview={isLowQualitySource ? "true" : undefined}
      data-workspace-thumbnail-preview={
        renderedSource.type === "workspace-thumbnail" ? "true" : undefined
      }
      data-workspace-original-preview={
        renderedSource.type === "workspace-original" ? "true" : undefined
      }
    />
  );
}
