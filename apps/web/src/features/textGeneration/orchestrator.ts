import { executeChatPromptStream } from "@/api/chatAdapter";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  beginGenerationTelemetry,
  classifyGenerationFailure,
  completeGenerationTelemetry,
} from "@/features/generationTelemetry";
import { createRichPromptDocumentFromText } from "@/features/richPrompt/promptCompiler";
import { getNodeModelSelection } from "@/features/settings/nodeModelSelection";
import { resolveRuntimeModelConfig } from "@/features/settings/providerConfig";
import { useCanvasStore } from "@/store/useCanvasStore";
import { reportDiagnostic } from "@/store/useDiagnosticsStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { createTextGenerationRunner } from "./runner";
import { useTextGenerationRuntime } from "./runtime";

export const textGenerationRunner = createTextGenerationRunner({
  readContext: (nodeId) => {
    const projectId = useProjectStore.getState().activeProjectId;
    const session = useAuthStore.getState().session;
    const node = useCanvasStore
      .getState()
      .nodes.find(
        (candidate) => candidate.id === nodeId && candidate.type === "textNode",
      );
    if (!projectId || !session || !node) return null;
    return {
      scope: `${session.user.id}:${session.workspace.id}:${projectId}`,
      content: JSON.stringify([node.data.text, node.data.richPrompt]),
    };
  },
  publish: (nodeId, state) =>
    useTextGenerationRuntime.getState().patch(nodeId, state),
  commit: (nodeId, text) => {
    const history = useHistoryStore.getState();
    history.commitTransaction();
    history.runTracked(() =>
      useCanvasStore.getState().updateNodeData(nodeId, {
        text,
        richPrompt: createRichPromptDocumentFromText(text),
        generationMode: "text",
      }),
    );
    useTextGenerationRuntime.getState().patch(nodeId, { panelOpen: false });
  },
  onError: (error) => {
    reportDiagnostic(
      {
        area: "model",
        code: "TEXT_GENERATION_FAILED",
        title: "文本生成失败",
        error,
        privateProviderError: true,
      },
      { notify: false },
    );
    return "生成失败，请检查模型设置或服务商连接后重试。";
  },
});

export function resetTextGenerationRuntime() {
  textGenerationRunner.cancelAll();
  useTextGenerationRuntime.getState().reset();
}

export async function generateTextNode(nodeId: string) {
  const node = useCanvasStore
    .getState()
    .nodes.find(
      (candidate) => candidate.id === nodeId && candidate.type === "textNode",
    );
  if (
    !node ||
    useTextGenerationRuntime.getState().nodes[nodeId]?.status === "running"
  )
    return;
  const prompt =
    typeof node.data.generationPrompt === "string"
      ? node.data.generationPrompt.trim()
      : "";
  if (!prompt) return;
  const config = useSettingsStore.getState().config;
  const selection = getNodeModelSelection(config, {
    category: "chat",
    reference: node.data.model,
  });
  const resolution =
    selection.canExecute && selection.modelEntryId
      ? resolveRuntimeModelConfig(config, {
          modelEntryId: selection.modelEntryId,
          category: "chat",
          requireCredentials: true,
        })
      : null;
  if (!resolution?.ok) {
    useTextGenerationRuntime.getState().patch(nodeId, {
      status: "error",
      preview: null,
      error: "请选择可用的文本模型，并在模型设置中配置凭据。",
    });
    return;
  }
  await textGenerationRunner.run(nodeId, async (signal, onDelta) => {
    const attempt = beginGenerationTelemetry("text");
    try {
      let lastUpdate = 0;
      const text = await executeChatPromptStream(
        {
          model: resolution.runtimeConfig,
          instructionPrompt: prompt,
          inputText: "",
          outputFormat: "text",
          signal,
        },
        {
          onDelta: (_delta, fullText) => {
            if (Date.now() - lastUpdate < 80) return;
            lastUpdate = Date.now();
            onDelta(fullText);
          },
        },
      );
      signal.throwIfAborted();
      completeGenerationTelemetry(attempt, {
        status: "succeeded",
        resultCount: 1,
      });
      return text;
    } catch (error) {
      completeGenerationTelemetry(
        attempt,
        signal.aborted
          ? { status: "canceled" }
          : {
              status: "failed",
              failureCategory: classifyGenerationFailure(error),
            },
      );
      throw error;
    }
  });
}
