import { CanvasImagePreview } from "@/components/CanvasImagePreview";
import {
  getCanvasNodeById,
  isConnectedImageSourceNode,
} from "@/store/canvasConnectionSources";
import { useCanvasStore } from "@/store/useCanvasStore";
import type { RichPromptReferenceItem } from "./types";

export function ImageMentionPreview({
  sourceId,
  imageUrl,
  thumbnailRelativePath,
  className,
}: Pick<
  RichPromptReferenceItem,
  "sourceId" | "imageUrl" | "thumbnailRelativePath"
> & { className: string }) {
  // Saved mentions can outlive signed/blob URLs and need the source asset to recover.
  const sourceData = useCanvasStore((state) => {
    const source = getCanvasNodeById(state.nodes, sourceId);
    return isConnectedImageSourceNode(source) ? source.data : null;
  });

  return (
    <CanvasImagePreview
      src={sourceData?.imageUrl || imageUrl}
      alt=""
      imageAsset={
        sourceData?.imageAsset ??
        (thumbnailRelativePath ? { thumbnailRelativePath } : null)
      }
      className={className}
      draggable={false}
      forceLowQualityPreview
      errorPresentation="compact"
    />
  );
}
