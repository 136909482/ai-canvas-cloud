import assert from "node:assert/strict";
import test from "node:test";
import { executeChatPromptStream } from "./chatAdapter";

const params = {
  model: {
    apiUrl: "https://example.test/v1",
    apiKey: "test-key",
    modelId: "test-chat",
  },
  instructionPrompt: "写两行文字",
  inputText: "",
  outputFormat: "text" as const,
};

test("chat stream forwards cancellation, preserves newlines and closes the response reader", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let canceled = false;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.signal, controller.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    assert.equal(body.model, "test-chat");
    return new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"第一行\\n第二行"}}]}\n\ndata: [DONE]\n\n',
            ),
          );
        },
        cancel() {
          canceled = true;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  try {
    const deltas: string[] = [];
    const text = await executeChatPromptStream(
      { ...params, signal: controller.signal },
      { onDelta: (_delta, full) => deltas.push(full) },
    );
    assert.equal(text, "第一行\n第二行");
    assert.deepEqual(deltas, [text]);
    assert.equal(canceled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat streaming also accepts providers returning a normal JSON completion", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "正文\n第二行" } }] });
  try {
    assert.equal(await executeChatPromptStream(params), "正文\n第二行");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("abort during streaming rejects instead of returning partial content", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            ),
          );
          stream.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  try {
    await assert.rejects(
      executeChatPromptStream(
        { ...params, signal: controller.signal },
        { onDelta: () => controller.abort() },
      ),
      { name: "AbortError" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
