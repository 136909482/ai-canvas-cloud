import {
  createRichPromptDocumentFromText,
  richPromptToPlainText,
} from "@/features/richPrompt/promptCompiler";
import type { RichPromptDocument } from "@/features/richPrompt/types";

type PromptContent = {
  prompt: string;
  richPrompt: RichPromptDocument | null;
};

function readPromptContent(data: Record<string, unknown>): PromptContent {
  const richPrompt = data.richPrompt;
  return {
    prompt: typeof data.prompt === "string" ? data.prompt : "",
    richPrompt:
      richPrompt && typeof richPrompt === "object" && !Array.isArray(richPrompt)
        ? (richPrompt as RichPromptDocument)
        : null,
  };
}

export function getGenerateEditablePrompt(
  data: Record<string, unknown>,
): PromptContent {
  if (!data.connectedTextNode) return readPromptContent(data);
  const supplement = data.promptSupplement;
  // Legacy connected nodes contain the upstream text in prompt, not an addition.
  return readPromptContent(
    supplement && typeof supplement === "object" && !Array.isArray(supplement)
      ? (supplement as Record<string, unknown>)
      : {},
  );
}

export function getConnectedGeneratePromptPatch(
  data: Record<string, unknown>,
  source: {
    sourceId: string | null;
    text: string;
    richPrompt: RichPromptDocument | null;
  },
): Record<string, unknown> {
  if (!source.sourceId) {
    if (!data.connectedTextNode) return {};
    return {
      connectedTextNode: null,
      ...getGenerateEditablePrompt(data),
      promptSupplement: null,
    };
  }

  const supplement = getGenerateEditablePrompt(data);
  const parts = [
    { prompt: source.text, richPrompt: source.richPrompt },
    supplement,
  ]
    .map((part) => {
      const richText = richPromptToPlainText(part.richPrompt);
      const prompt = (richText || part.prompt).trim();
      return {
        prompt,
        richPrompt: richText
          ? part.richPrompt!
          : createRichPromptDocumentFromText(prompt),
      };
    })
    .filter((part) => part.prompt);
  const prompt = parts.map((part) => part.prompt).join("\n");
  const richPrompt: RichPromptDocument = {
    type: "doc",
    content: parts.flatMap((part) => part.richPrompt.content ?? []),
  };
  const patch: Record<string, unknown> = {};
  if (data.connectedTextNode !== source.sourceId)
    patch.connectedTextNode = source.sourceId;
  if (!data.promptSupplement) patch.promptSupplement = supplement;
  if (data.prompt !== prompt) patch.prompt = prompt;
  if (JSON.stringify(data.richPrompt) !== JSON.stringify(richPrompt))
    patch.richPrompt = richPrompt;
  return patch;
}
