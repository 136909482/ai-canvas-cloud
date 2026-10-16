import { AlignLeft } from "lucide-react";
import { GenerationReferenceCard } from "./GenerationReferenceCard";

export function ConnectedTextReference({
  text,
  onDisconnect,
}: {
  text: string;
  onDisconnect: () => void;
}) {
  return (
    <GenerationReferenceCard
      label="连接的文本"
      badge="1"
      testId="connected-text-reference"
      disconnectLabel="断开文本连接"
      onDisconnect={onDisconnect}
      preview={
        <div className="max-h-[min(18rem,50dvh)] w-72 max-w-[calc(100vw-3rem)] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-xl border border-[var(--floating-panel-border)] bg-[var(--panel-bg-strong)] p-3 text-xs leading-5 text-[var(--text-primary)] shadow-lg">
          {text || "文本节点暂无内容"}
        </div>
      }
    >
      <AlignLeft className="h-5 w-5" aria-hidden="true" />
    </GenerationReferenceCard>
  );
}
