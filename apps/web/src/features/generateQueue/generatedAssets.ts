import { downloadMediaAsBlob } from "@/api/image/shared";
import { writeWorkspaceImageAsset } from "@/features/imageAssets/runtime";
import { buildProjectAssetPath } from "@/features/projectManager/projectAssetPaths";
import {
  deleteRememberedPendingTaskResult,
  isLocalVaultSupported,
  loadRememberedPendingTaskResult,
  saveRememberedPendingTaskResult,
} from "@/features/settings/localVault";
import { platformBridge } from "@/platform";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { GenerateTask, WorkspaceImageAsset } from "@/types";

const pendingImageResults = new Map<string, Blob>();

function buildAssetFolderDate(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveGeneratedAssetProjectId(
  taskProjectId: string | null | undefined,
  activeProjectId: string | null | undefined,
) {
  return taskProjectId?.trim() || activeProjectId?.trim() || null;
}

export function buildGeneratedImageFileName(
  task: GenerateTask,
  mimeType: string,
) {
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : mimeType === "image/gif"
          ? "gif"
          : "png";

  return `generated-${task.id}.${extension}`;
}

export function buildGeneratedVideoFileName(
  task: GenerateTask,
  mimeType: string,
) {
  const extension =
    mimeType === "video/webm"
      ? "webm"
      : mimeType === "video/quicktime"
        ? "mov"
        : "mp4";

  return `generated-${task.id}.${extension}`;
}

async function downloadGeneratedImageAsBlob(imageUrl: string) {
  return downloadMediaAsBlob(imageUrl, "Failed to fetch generated image");
}

function getPendingResultContext(task: GenerateTask) {
  const settings = useSettingsStore.getState();
  const userId = settings.runtime.vaultUserId;
  const projectId = task.projectId?.trim() ?? "";

  if (
    !userId ||
    !projectId ||
    settings.runtime.vaultPersistence !== "device" ||
    !isLocalVaultSupported()
  ) {
    return null;
  }

  return { userId, projectId };
}

export async function stageGeneratedImageResult(
  task: GenerateTask,
  imageUrl: string,
) {
  const blob = await downloadGeneratedImageAsBlob(imageUrl);
  pendingImageResults.set(task.id, blob);
  const context = getPendingResultContext(task);

  if (context) {
    await saveRememberedPendingTaskResult(
      context.userId,
      context.projectId,
      task.id,
      blob,
    );
  }

  return blob;
}

export async function loadStagedGeneratedImageResult(task: GenerateTask) {
  const inMemory = pendingImageResults.get(task.id);
  if (inMemory) return inMemory;

  const context = getPendingResultContext(task);
  if (!context) return null;
  const blob = await loadRememberedPendingTaskResult(
    context.userId,
    context.projectId,
    task.id,
  );
  if (blob) pendingImageResults.set(task.id, blob);
  return blob;
}

export async function clearStagedGeneratedImageResult(task: GenerateTask) {
  pendingImageResults.delete(task.id);
  const context = getPendingResultContext(task);
  if (!context) return;

  await deleteRememberedPendingTaskResult(
    context.userId,
    context.projectId,
    task.id,
  ).catch(() => undefined);
}

async function downloadGeneratedVideoAsBlob(videoUrl: string) {
  return downloadMediaAsBlob(videoUrl, "Failed to fetch generated video");
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to convert generated image to data URL"));
    };

    reader.onerror = () => {
      reject(
        reader.error ??
          new Error("Failed to convert generated image to data URL"),
      );
    };

    reader.readAsDataURL(blob);
  });
}

export async function persistGeneratedImageAsset(
  task: GenerateTask,
  imageUrl: string,
): Promise<{ asset: WorkspaceImageAsset | null; resolvedUrl: string }> {
  const blob = await stageGeneratedImageResult(task, imageUrl);
  const result = await persistGeneratedImageBlob(task, blob);
  await clearStagedGeneratedImageResult(task);
  return result;
}

export async function persistGeneratedImageBlob(
  task: GenerateTask,
  blob: Blob,
): Promise<{ asset: WorkspaceImageAsset | null; resolvedUrl: string }> {
  if (!useSettingsStore.getState().runtime.workspaceConfigured) {
    return {
      asset: null,
      resolvedUrl: await blobToDataUrl(blob),
    };
  }

  const projectId = resolveGeneratedAssetProjectId(
    task.projectId,
    useProjectStore.getState().activeProjectId,
  );
  const asset = await writeWorkspaceImageAsset({
    pathSegments: buildProjectAssetPath(
      projectId,
      "generated",
      buildAssetFolderDate(task.createdAt),
    ),
    fileName: buildGeneratedImageFileName(task, blob.type || "image/png"),
    blob,
  });
  const resolvedUrl = await platformBridge.resolveWorkspaceAssetUrl(
    asset.relativePath,
  );

  return {
    asset,
    resolvedUrl,
  };
}

export async function persistGeneratedVideoAsset(
  task: GenerateTask,
  videoUrl: string,
): Promise<{ asset: WorkspaceImageAsset | null; resolvedUrl: string }> {
  if (!useSettingsStore.getState().runtime.workspaceConfigured) {
    return {
      asset: null,
      resolvedUrl: videoUrl,
    };
  }

  const blob = await downloadGeneratedVideoAsBlob(videoUrl);

  const projectId = resolveGeneratedAssetProjectId(
    task.projectId,
    useProjectStore.getState().activeProjectId,
  );
  const asset = await platformBridge.writeWorkspaceAsset({
    pathSegments: buildProjectAssetPath(
      projectId,
      "generated",
      buildAssetFolderDate(task.createdAt),
    ),
    fileName: buildGeneratedVideoFileName(task, blob.type || "video/mp4"),
    blob,
  });
  const resolvedUrl = await platformBridge.resolveWorkspaceAssetUrl(
    asset.relativePath,
  );

  return {
    asset,
    resolvedUrl,
  };
}

export function loadVideoMetadata(videoUrl: string) {
  return new Promise<{ duration: number; width: number; height: number }>(
    (resolve, reject) => {
      const video = document.createElement("video");

      video.preload = "metadata";
      video.onloadedmetadata = () =>
        resolve({
          duration: Number.isFinite(video.duration) ? video.duration : 0,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      video.onerror = () =>
        reject(new Error("Failed to load generated video metadata"));
      video.src = videoUrl;
    },
  );
}

export function getVideoNodeSize(width: number, height: number) {
  const aspectRatio = width > 0 && height > 0 ? width / height : 16 / 9;
  const widthValue = aspectRatio >= 1 ? 360 : 260;
  const heightValue = Math.round(widthValue / aspectRatio);

  return {
    width: widthValue,
    height: Math.max(heightValue, 180),
  };
}
