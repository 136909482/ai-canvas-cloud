import assert from "node:assert/strict";
import test from "node:test";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  createRichPromptDocumentFromText,
  richPromptToPlainText,
} from "@/features/richPrompt/promptCompiler";
import { getTextFromSourceEdge } from "@/store/canvasConnectionSources";
import { buildManualTextNode } from "@/store/canvasNodeCreation";
import { normalizeConfig } from "@/store/settingsConfig";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { generateTextNode, resetTextGenerationRuntime } from "./orchestrator";
import { useTextGenerationRuntime } from "./runtime";

test("text execution replaces the original node once, preserves downstream text and undoes in one step", async () => {
  const originalCanvas = useCanvasStore.getState();
  const originalSettings = useSettingsStore.getState();
  const originalProject = useProjectStore.getState();
  const originalAuth = useAuthStore.getState();
  const originalFetch = globalThis.fetch;
  const node = buildManualTextNode(
    "text-source",
    { x: 0, y: 0 },
    { width: 280, height: 220 },
  );
  node.data = {
    ...node.data,
    text: "原正文",
    richPrompt: createRichPromptDocumentFromText("原正文"),
    generationMode: "text",
    generationPrompt: "写两行文字",
    model: "chat-entry",
  };
  const generated = "生成正文\n第二行";
  let requests = 0;
  const unsubscribeRuntime = useTextGenerationRuntime.subscribe((state) => {
    if (state.nodes[node.id]?.status === "running")
      assert.equal(useCanvasStore.getState().nodes[0]?.data.text, "原正文");
  });
  try {
    useCanvasStore.setState({ nodes: [node], edges: [] });
    useProjectStore.setState({ activeProjectId: "project-a" });
    useAuthStore.setState({
      status: "authenticated",
      session: {
        user: {
          id: "account-a",
          userNumber: 1,
          username: "account_a",
          email: "a@example.test",
          status: "active",
          emailVerified: true,
        },
        workspace: {
          id: "workspace-a",
          type: "personal",
          name: "A",
          role: "owner",
          status: "active",
          planKey: "free",
        },
      },
    });
    useSettingsStore.setState({
      config: normalizeConfig({
        providerProfiles: [
          {
            id: "chat-provider",
            name: "Chat",
            protocol: "openai-compatible",
            authMode: "bearer",
            baseUrl: "https://chat.example.test/v1",
            enabled: true,
            imageRequestMode: "sync",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        providerApiKeys: { "chat-provider": "test-key" },
        modelEntries: [
          {
            id: "chat-entry",
            providerProfileId: "chat-provider",
            modelId: "test-chat",
            displayName: "Chat",
            category: "chat",
            source: "manual",
            status: "available",
            enabled: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    });
    useHistoryStore.getState().clearHistory();
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith("/api/")) return Response.json({ ok: true });
      requests += 1;
      assert.equal(
        String(input),
        "https://chat.example.test/v1/chat/completions",
      );
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer test-key",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[0].content.includes("写两行文字"), true);
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: generated } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    await generateTextNode(node.id);
    assert.equal(requests, 1);
    const current = useCanvasStore.getState();
    assert.equal(current.nodes.length, 1);
    assert.equal(current.edges.length, 0);
    assert.equal(current.nodes[0]?.id, node.id);
    assert.equal(current.nodes[0]?.data.text, generated);
    assert.equal(
      richPromptToPlainText(
        current.nodes[0]?.data.richPrompt as typeof node.data.richPrompt,
      ),
      generated,
    );
    assert.equal(current.nodes[0]?.data.generationPrompt, "写两行文字");
    assert.equal(current.nodes[0]?.data.generationMode, "text");
    assert.equal(
      getTextFromSourceEdge(current.nodes, {
        id: "output",
        source: node.id,
        target: "image",
        sourceHandle: "output",
      }).text,
      generated,
    );
    assert.equal(
      useTextGenerationRuntime.getState().nodes[node.id]?.panelOpen,
      false,
    );
    assert.equal(
      useTextGenerationRuntime.getState().nodes[node.id]?.status,
      "idle",
    );
    assert.equal(useHistoryStore.getState().past.length, 1);
    useHistoryStore.getState().undo();
    assert.equal(useCanvasStore.getState().nodes[0]?.data.text, "原正文");
    useHistoryStore.getState().redo();
    assert.equal(useCanvasStore.getState().nodes[0]?.data.text, generated);
  } finally {
    unsubscribeRuntime();
    resetTextGenerationRuntime();
    globalThis.fetch = originalFetch;
    useHistoryStore.getState().clearHistory();
    useCanvasStore.setState(originalCanvas, true);
    useSettingsStore.setState(originalSettings, true);
    useProjectStore.setState(originalProject, true);
    useAuthStore.setState(originalAuth, true);
  }
});
