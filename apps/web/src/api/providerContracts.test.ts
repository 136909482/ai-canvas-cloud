import assert from "node:assert/strict";
import test from "node:test";
import { executeChatPrompt } from "./chatAdapter.ts";
import { generateWithQwen } from "./image/aliyun.ts";
import {
  generateWithOpenAI,
  submitOpenAiAsyncImageGeneration,
} from "./image/openai.ts";
import { submitAliyunTextToVideoGeneration } from "./videoAdapter.ts";

type CapturedRequest = {
  input: string | URL | Request;
  init?: RequestInit;
};

async function withMockFetch<T>(
  responder: (request: CapturedRequest) => Response | Promise<Response>,
  action: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = async (input, init) => {
    const request = { input, init };
    requests.push(request);
    return responder(request);
  };

  try {
    return { result: await action(), requests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function getHeader(init: RequestInit | undefined, name: string) {
  return new Headers(init?.headers).get(name);
}

const GPT_IMAGE_SIZE_CASES = [
  ["1:1", "1K", "1024x1024"],
  ["1:1", "2K", "2048x2048"],
  ["1:1", "4K", "2880x2880"],
  ["3:2", "1K", "1536x1024"],
  ["3:2", "2K", "2048x1360"],
  ["3:2", "4K", "3520x2336"],
  ["2:3", "1K", "1024x1536"],
  ["2:3", "2K", "1360x2048"],
  ["2:3", "4K", "2336x3520"],
  ["4:3", "1K", "1024x768"],
  ["4:3", "2K", "2048x1536"],
  ["4:3", "4K", "3312x2480"],
  ["3:4", "1K", "768x1024"],
  ["3:4", "2K", "1536x2048"],
  ["3:4", "4K", "2480x3312"],
  ["5:4", "1K", "1280x1024"],
  ["5:4", "2K", "2560x2048"],
  ["5:4", "4K", "3216x2576"],
  ["4:5", "1K", "1024x1280"],
  ["4:5", "2K", "2048x2560"],
  ["4:5", "4K", "2576x3216"],
  ["16:9", "1K", "1536x864"],
  ["16:9", "2K", "2048x1152"],
  ["16:9", "4K", "3840x2160"],
  ["9:16", "1K", "864x1536"],
  ["9:16", "2K", "1152x2048"],
  ["9:16", "4K", "2160x3840"],
  ["2:1", "1K", "1774x887"],
  ["2:1", "2K", "2688x1344"],
  ["2:1", "4K", "3840x1920"],
  ["1:2", "1K", "887x1774"],
  ["1:2", "2K", "1344x2688"],
  ["1:2", "4K", "1920x3840"],
  ["3:1", "1K", "1536x512"],
  ["3:1", "2K", "3072x1024"],
  ["3:1", "4K", "3840x1280"],
  ["1:3", "1K", "512x1536"],
  ["1:3", "2K", "1024x3072"],
  ["1:3", "4K", "1280x3840"],
  ["21:9", "1K", "2016x864"],
  ["21:9", "2K", "2688x1152"],
  ["21:9", "4K", "3840x1648"],
  ["9:21", "1K", "864x2016"],
  ["9:21", "2K", "1152x2688"],
  ["9:21", "4K", "1648x3840"],
] as const;

test("Aliyun image provider sends its documented endpoint, authorization, and payload", async () => {
  const { result, requests } = await withMockFetch(
    () =>
      Response.json({
        output: {
          choices: [
            {
              message: { content: [{ image: "https://cdn.example/qwen.png" }] },
            },
          ],
        },
      }),
    () =>
      generateWithQwen({
        prompt: "draw a square",
        negativePrompt: "noise",
        ratio: "16:9",
        apiKey: "aliyun-key",
        apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-image-2.0-pro",
        provider: "aliyun",
        operationType: "text-to-image",
      }),
  );

  assert.equal(result, "https://cdn.example/qwen.png");
  assert.equal(
    String(requests[0]?.input),
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  );
  assert.equal(
    getHeader(requests[0]?.init, "authorization"),
    "Bearer aliyun-key",
  );
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(body.model, "qwen-image-2.0-pro");
  assert.equal(body.input.messages[0].content[0].text, "draw a square");
  assert.equal(body.parameters.size, "1664*928");
  assert.equal(body.parameters.negative_prompt, "noise");
});

test("OpenAI compatible sync image provider preserves model options and extracts URL results", async () => {
  const { result, requests } = await withMockFetch(
    () => Response.json({ data: [{ url: "https://cdn.example/openai.png" }] }),
    () =>
      generateWithOpenAI({
        prompt: "draw a circle",
        ratio: "1:1",
        resolution: "2k",
        quality: "high",
        apiKey: "openai-key",
        apiUrl: "https://images.example/v1",
        model: "gpt-image-2",
        provider: "openai",
        requestMode: "sync",
        operationType: "text-to-image",
      }),
  );

  assert.equal(result, "https://cdn.example/openai.png");
  assert.equal(
    String(requests[0]?.input),
    "https://images.example/v1/images/generations",
  );
  assert.equal(
    getHeader(requests[0]?.init, "authorization"),
    "Bearer openai-key",
  );
  assert.equal(
    getHeader(requests[0]?.init, "content-type"),
    "application/json",
  );
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.deepEqual(
    {
      model: body.model,
      prompt: body.prompt,
      size: body.size,
      n: body.n,
      quality: body.quality,
      moderation: body.moderation,
      outputFormat: body.output_format,
    },
    {
      model: "gpt-image-2",
      prompt: "draw a circle",
      size: "2048x2048",
      n: 1,
      quality: "high",
      moderation: "auto",
      outputFormat: "png",
    },
  );
  assert.equal("resolution" in body, false);
});

test("OpenAI compatible image requests use every documented ratio and resolution size", async () => {
  for (const [ratio, resolution, expectedSize] of GPT_IMAGE_SIZE_CASES) {
    const { requests } = await withMockFetch(
      () => Response.json({ data: [{ url: "https://cdn.example/image.png" }] }),
      () =>
        generateWithOpenAI({
          prompt: "draw",
          ratio,
          resolution,
          apiKey: "openai-key",
          apiUrl: "https://images.example/v1",
          model: "gpt-image-2",
          provider: "openai",
          operationType: "text-to-image",
        }),
    );
    const body = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(body.size, expectedSize, `${resolution} ${ratio}`);
  }
});

test("OpenAI compatible image-to-image uses the documented edits multipart contract", async () => {
  const sourceImageUrl = "https://assets.example/source.png";
  const { result, requests } = await withMockFetch(
    (request) =>
      String(request.input) === sourceImageUrl
        ? new Response(new Uint8Array([137, 80, 78, 71]), {
            headers: { "content-type": "image/png" },
          })
        : Response.json({
            data: [{ url: "https://cdn.example/edited.png" }],
          }),
    () =>
      generateWithOpenAI({
        prompt: "make the sky purple",
        ratio: "1:1",
        resolution: "2k",
        quality: "high",
        referenceImageUrl: sourceImageUrl,
        apiKey: "openai-key",
        apiUrl: "https://images.example/v1",
        model: "gpt-image-2",
        provider: "openai",
        requestMode: "sync",
        operationType: "image-to-image",
      }),
  );

  assert.equal(result, "https://cdn.example/edited.png");
  assert.equal(requests.length, 2);
  assert.equal(
    String(requests[1]?.input),
    "https://images.example/v1/images/edits",
  );
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(
    getHeader(requests[1]?.init, "content-type"),
    null,
    "fetch must add the multipart boundary",
  );

  const body = requests[1]?.init?.body;
  assert.ok(body instanceof FormData);
  assert.equal(body.get("model"), "gpt-image-2");
  assert.equal(body.get("prompt"), "make the sky purple");
  assert.equal(body.get("size"), "2048x2048");
  assert.equal(body.get("n"), "1");
  assert.equal(body.get("quality"), "high");
  assert.equal(body.get("moderation"), "auto");
  assert.equal(body.get("output_format"), "png");
  assert.equal(body.has("image"), false);
  assert.equal(body.getAll("image[]").length, 1);
  assert.ok(body.get("image[]") instanceof Blob);
  assert.equal(body.has("resolution"), false);
});

test("OpenAI compatible image-to-image preserves multiple image file order", async () => {
  const sourceUrls = [
    "https://assets.example/first.png",
    "https://assets.example/second.webp",
  ];
  const { requests } = await withMockFetch(
    (request) => {
      const url = String(request.input);
      if (url === sourceUrls[0]) {
        return new Response(new Uint8Array([1]), {
          headers: { "content-type": "image/png" },
        });
      }
      if (url === sourceUrls[1]) {
        return new Response(new Uint8Array([2]), {
          headers: { "content-type": "image/webp" },
        });
      }
      return Response.json({
        data: [{ url: "https://cdn.example/edited.png" }],
      });
    },
    () =>
      generateWithOpenAI({
        prompt: "combine in order",
        ratio: "16:9",
        resolution: "1K",
        referenceImageUrls: sourceUrls,
        apiKey: "openai-key",
        apiUrl: "https://images.example/v1",
        model: "gpt-image-2",
        provider: "openai",
        operationType: "image-to-image",
      }),
  );

  const requestBody = requests.at(-1)?.init?.body;
  assert.ok(requestBody instanceof FormData);
  assert.equal(requestBody.get("size"), "1536x864");
  const files = requestBody.getAll("image[]");
  assert.equal(files.length, 2);
  assert.ok(files[0] instanceof File);
  assert.ok(files[1] instanceof File);
  assert.equal(files[0].name, "image_1.png");
  assert.equal(files[0].type, "image/png");
  assert.equal(files[1].name, "image_2.webp");
  assert.equal(files[1].type, "image/webp");
});

test("OpenAI compatible async provider accepts the task_id submission contract", async () => {
  const { result, requests } = await withMockFetch(
    () => Response.json({ task_id: "remote-task-1" }),
    () =>
      submitOpenAiAsyncImageGeneration({
        prompt: "draw a triangle",
        ratio: "1:1",
        apiKey: "async-key",
        apiUrl: "https://async.example/v1",
        model: "gpt-image-2",
        provider: "openai",
        requestMode: "async",
        operationType: "text-to-image",
      }),
  );

  assert.deepEqual(result, { taskId: "remote-task-1" });
  assert.equal(
    String(requests[0]?.input),
    "https://async.example/v1/images/generations",
  );
  assert.equal(
    getHeader(requests[0]?.init, "authorization"),
    "Bearer async-key",
  );
});

test("chat provider uses the OpenAI-compatible completion contract", async () => {
  const { result, requests } = await withMockFetch(
    () => Response.json({ choices: [{ message: { content: "  pong  " } }] }),
    () =>
      executeChatPrompt({
        model: {
          apiKey: "chat-key",
          apiUrl: "https://chat.example/v1/models",
          modelId: "chat-model",
        },
        systemPrompt: "Be concise.",
        instructionPrompt: "Answer the user.",
        inputText: "ping",
        outputFormat: "text",
      }),
  );

  assert.equal(result, "pong");
  assert.equal(
    String(requests[0]?.input),
    "https://chat.example/v1/chat/completions",
  );
  assert.equal(
    getHeader(requests[0]?.init, "authorization"),
    "Bearer chat-key",
  );
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(body.model, "chat-model");
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content, /ping/);
});

test("Aliyun video provider uses the fixed async synthesis contract", async () => {
  const { result, requests } = await withMockFetch(
    () => Response.json({ output: { task_id: "video-task-1" } }),
    () =>
      submitAliyunTextToVideoGeneration({
        prompt: "camera pans across a quiet lake",
        ratio: "16:9",
        resolution: "1080p",
        duration: "10s",
        apiKey: "video-key",
        apiUrl: "https://dashscope.example/arbitrary/path",
        model: "wan2.7-t2v-turbo",
      }),
  );

  assert.deepEqual(result, { taskId: "video-task-1" });
  assert.equal(
    String(requests[0]?.input),
    "https://dashscope.example/api/v1/services/aigc/video-generation/video-synthesis",
  );
  assert.equal(
    getHeader(requests[0]?.init, "authorization"),
    "Bearer video-key",
  );
  assert.equal(getHeader(requests[0]?.init, "x-dashscope-async"), "enable");
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.deepEqual(
    {
      model: body.model,
      prompt: body.input.prompt,
      resolution: body.parameters.resolution,
      duration: body.parameters.duration,
    },
    {
      model: "wan2.7-t2v-turbo",
      prompt: "camera pans across a quiet lake",
      resolution: "1080P",
      duration: 10,
    },
  );
});

test("provider HTTP failures preserve status and response details", async () => {
  await assert.rejects(
    () =>
      withMockFetch(
        () =>
          new Response("quota exhausted", {
            status: 429,
            statusText: "Too Many Requests",
          }),
        () =>
          executeChatPrompt({
            model: {
              apiKey: "chat-key",
              apiUrl: "https://chat.example/v1",
              modelId: "chat-model",
            },
            instructionPrompt: "",
            inputText: "ping",
            outputFormat: "text",
          }),
      ),
    /429 quota exhausted/,
  );
});
