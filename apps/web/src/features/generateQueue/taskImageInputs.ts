import type { GenerateTask, GenerateTaskImageSource } from "@/types";

export interface ResolvedTaskImageInputs {
  referenceImageUrls: string[];
  editImageUrl: string | null;
  maskImageUrl: string | null;
}

interface TaskImageInputDependencies {
  resolveAssetUrl: (relativePath: string) => Promise<string>;
  clearAssetUrlCache: () => void;
}

function getReferenceImages(task: GenerateTask) {
  return task.referenceImages;
}

async function resolveImageSource(
  source: GenerateTaskImageSource | null | undefined,
  label: string,
  resolveAssetUrl: (relativePath: string) => Promise<string>,
  allowUrlFallback: boolean,
) {
  if (!source) {
    return null;
  }

  if (!source.assetRelativePath) {
    return source.imageUrl;
  }

  try {
    return await resolveAssetUrl(source.assetRelativePath);
  } catch (error) {
    if (allowUrlFallback && source.imageUrl) {
      return source.imageUrl;
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}访问凭证刷新失败：${reason}`);
  }
}

export async function resolveTaskImageInputs(
  task: GenerateTask,
  resolveAssetUrl: (relativePath: string) => Promise<string>,
  options: { allowUrlFallback?: boolean } = {},
): Promise<ResolvedTaskImageInputs> {
  const allowUrlFallback = options.allowUrlFallback ?? true;
  const referenceImages = getReferenceImages(task);
  const referenceImageUrls = await Promise.all(
    referenceImages.map(async (source, index) => {
      const resolved = await resolveImageSource(
        source,
        `第 ${index + 1} 张参考图`,
        resolveAssetUrl,
        allowUrlFallback,
      );
      return resolved ?? source.imageUrl;
    }),
  );

  return {
    referenceImageUrls,
    editImageUrl: await resolveImageSource(
      task.editImageSource,
      "编辑原图",
      resolveAssetUrl,
      allowUrlFallback,
    ),
    maskImageUrl: await resolveImageSource(
      task.maskImageSource,
      "蒙版图",
      resolveAssetUrl,
      allowUrlFallback,
    ),
  };
}

export function isReferenceImageForbiddenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^Reference image \d+ fetch failed: HTTP 403(?:\s|$)/.test(message);
}

function hasPersistentImageSource(task: GenerateTask) {
  return [
    ...getReferenceImages(task),
    task.editImageSource,
    task.maskImageSource,
  ].some((source) => Boolean(source?.assetRelativePath));
}

export async function runWithTaskImageInputRefresh<T>(
  task: GenerateTask,
  dependencies: TaskImageInputDependencies,
  execute: (inputs: ResolvedTaskImageInputs) => Promise<T>,
) {
  const initialInputs = await resolveTaskImageInputs(
    task,
    dependencies.resolveAssetUrl,
  );

  try {
    return await execute(initialInputs);
  } catch (error) {
    if (
      !isReferenceImageForbiddenError(error) ||
      !hasPersistentImageSource(task)
    ) {
      throw error;
    }

    dependencies.clearAssetUrlCache();
    const refreshedInputs = await resolveTaskImageInputs(
      task,
      dependencies.resolveAssetUrl,
      { allowUrlFallback: false },
    );
    return execute(refreshedInputs);
  }
}
