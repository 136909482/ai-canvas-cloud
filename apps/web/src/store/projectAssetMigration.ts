import { writeWorkspaceImageThumbnailAsset } from "@/features/imageAssets/runtime";
import { getWorkspaceAssetPathParts } from "@/features/projectManager/projectAssetPaths";
import { isVolatileCloudMemoryAssetPath } from "@/features/projectManager/volatileCloudAssetPath";
import { platformBridge, platformRuntime } from "@/platform";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { reportDiagnostic } from "@/store/useDiagnosticsStore";
import {
  isWorkspaceAssetNodeType,
  type ProjectSnapshot,
  type WorkspaceImageAsset,
} from "@/types";

export function isStorageConfigured() {
  return useSettingsStore.getState().runtime.workspaceConfigured;
}

function getImageAssetFileName(asset: {
  relativePath?: unknown;
  fileName?: unknown;
}) {
  if (typeof asset.fileName === "string" && asset.fileName.trim()) {
    return asset.fileName;
  }
  if (typeof asset.relativePath === "string" && asset.relativePath.trim()) {
    return (
      asset.relativePath.replace(/\\+/g, "/").split("/").pop() || "image.png"
    );
  }
  return "image.png";
}

function isWorkspaceImageAsset(value: unknown): value is WorkspaceImageAsset {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as WorkspaceImageAsset).relativePath === "string",
  );
}

async function enrichWorkspaceImageAssetThumbnail(
  asset: WorkspaceImageAsset,
  cache: Map<string, Promise<WorkspaceImageAsset>>,
  stats?: { thumbnailBackfillCount: number },
) {
  if (asset.thumbnailRelativePath || !asset.relativePath) return asset;
  const cached = cache.get(asset.relativePath);
  if (cached) return cached;

  const request = (async () => {
    try {
      const imageUrl = await platformBridge.resolveWorkspaceAssetUrl(
        asset.relativePath,
      );
      const response = await fetch(imageUrl);
      if (!response.ok) return asset;
      const blob = await response.blob();
      const pathParts = getWorkspaceAssetPathParts(
        asset.relativePath,
        getImageAssetFileName(asset),
      );
      const thumbnailMeta = await writeWorkspaceImageThumbnailAsset({
        pathSegments: pathParts.pathSegments,
        fileName: getImageAssetFileName(asset),
        blob,
        originalWidth: asset.originalWidth,
        originalHeight: asset.originalHeight,
      });
      if (thumbnailMeta.thumbnailRelativePath && stats) {
        stats.thumbnailBackfillCount += 1;
      }
      return { ...asset, ...thumbnailMeta };
    } catch {
      return asset;
    }
  })();

  cache.set(asset.relativePath, request);
  return request;
}

export async function prepareSnapshotAssetMetadata(
  snapshot: ProjectSnapshot,
  options?: {
    updateLiveCanvas?: boolean;
    thumbnailCache?: Map<string, Promise<WorkspaceImageAsset>>;
    stats?: { thumbnailBackfillCount: number };
  },
) {
  if (!isStorageConfigured()) return snapshot;
  const thumbnailCache =
    options?.thumbnailCache ?? new Map<string, Promise<WorkspaceImageAsset>>();
  const nodes = await Promise.all(
    snapshot.canvas.nodes.map(async (node) => {
      if (!isWorkspaceAssetNodeType(node.type) || node.type === "videoNode") {
        return node;
      }
      if (!isWorkspaceImageAsset(node.data?.imageAsset)) return node;
      const imageAsset = await enrichWorkspaceImageAssetThumbnail(
        node.data.imageAsset,
        thumbnailCache,
        options?.stats,
      );
      if (options?.updateLiveCanvas && imageAsset !== node.data.imageAsset) {
        useCanvasStore.getState().updateNodeData(node.id, { imageAsset });
      }
      return imageAsset === node.data.imageAsset
        ? node
        : { ...node, data: { ...node.data, imageAsset } };
    }),
  );
  const tasks = await Promise.all(
    snapshot.taskQueue.tasks.map(async (task) => {
      if (!isWorkspaceImageAsset(task.resultImageAsset)) return task;
      const resultImageAsset = await enrichWorkspaceImageAssetThumbnail(
        task.resultImageAsset,
        thumbnailCache,
        options?.stats,
      );
      return resultImageAsset === task.resultImageAsset
        ? task
        : { ...task, resultImageAsset };
    }),
  );
  return {
    ...snapshot,
    canvas: { ...snapshot.canvas, nodes },
    taskQueue: { ...snapshot.taskQueue, tasks },
  };
}

export async function resolveWorkspaceNodeAssetUrls() {
  const { nodes, updateNodeData } = useCanvasStore.getState();
  await Promise.all(
    nodes.map(async (node) => {
      if (!isWorkspaceAssetNodeType(node.type)) return;
      const media = node.type === "videoNode" ? "video" : "image";
      const asset = (
        media === "video" ? node.data?.videoAsset : node.data?.imageAsset
      ) as { relativePath?: unknown } | null | undefined;
      const relativePath =
        typeof asset?.relativePath === "string" ? asset.relativePath : null;
      if (!relativePath) return;
      if (
        platformRuntime === "cloud" &&
        isVolatileCloudMemoryAssetPath(relativePath)
      ) {
        updateNodeData(
          node.id,
          media === "video"
            ? { videoAsset: null, videoUrl: "" }
            : { imageAsset: null, imageUrl: "" },
        );
        return;
      }
      try {
        const url = await platformBridge.resolveWorkspaceAssetUrl(relativePath);
        updateNodeData(
          node.id,
          media === "video" ? { videoUrl: url } : { imageUrl: url },
        );
      } catch (error) {
        reportDiagnostic({
          area: "resource",
          title: media === "video" ? "视频资源恢复失败" : "图片资源恢复失败",
          error,
          code:
            media === "video"
              ? "VIDEO_ASSET_RESTORE_FAILED"
              : "IMAGE_ASSET_RESTORE_FAILED",
          retryable: false,
          context: { nodeId: node.id, relativePath },
        });
      }
    }),
  );
}
