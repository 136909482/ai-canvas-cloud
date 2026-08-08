import assert from "node:assert/strict";
import test from "node:test";
import type { CustomImageProviderManifestV1, ProviderAuthMode } from "@/types";
import {
  startCustomImageGeneration,
  waitForCustomImageGeneration,
} from "./custom.ts";
import type { GenerateImageParams } from "./types.ts";

type CapturedRequest = {
  input: string | URL | Request;
  init?: RequestInit;
};

async function withMockFetch<T>(
  responder: (request: CapturedRequest, index: number) => Response,
  action: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = async (input, init) => {
    const request = { input, init };
    requests.push(request);
    return responder(request, requests.length - 1);
  };

  try {
    return { result: await action(), requests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createSyncManifest(): CustomImageProviderManifestV1 {
  return {
    id: "manifest-sync",
    schemaVersion: 1,
    name: "Sync custom image API",
    executionMode: "sync",
    capabilities: { generate: true, edit: false },
    submit: {
      generate: {
        path: "v1/images/generate",
        method: "POST",
        contentType: "json",
        query: { response_format: "json", requested_model: "$model" },
        body: {
          model: "$model",
          prompt: "$prompt",
          negative_prompt: "$negativePrompt",
          size: "$params.size",
          width: "$params.width",
          height: "$params.height",
        },
        result: {
          imageUrlPaths: ["data.items.*.url"],
          base64Paths: ["data.items.*.b64"],
        },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createPollingManifest(
  method: "GET" | "POST",
): CustomImageProviderManifestV1 {
  return {
    id: `manifest-poll-${method.toLowerCase()}`,
    schemaVersion: 1,
    name: "Polling custom image API",
    executionMode: "polling",
    capabilities: { generate: true, edit: false },
    submit: {
      generate: {
        path: "v1/tasks",
        method: "POST",
        contentType: "json",
        body: { model: "$model", prompt: "$prompt" },
        taskIdPath: "job.id",
      },
    },
    poll: {
      path: "v1/tasks/{task_id}",
      method,
      query: { task: "$taskId" },
      body: method === "POST" ? { task_id: "$taskId" } : undefined,
      intervalSeconds: 0,
      timeoutSeconds: 1,
      statusPath: "job.status",
      successValues: ["SUCCEEDED"],
      failureValues: ["FAILED", "CANCELED"],
      errorPath: "job.error.message",
      result: {
        imageUrlPaths: ["job.outputs.*.url"],
        base64Paths: ["job.outputs.*.b64"],
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createParams(
  manifest: CustomImageProviderManifestV1,
  authMode: ProviderAuthMode = "bearer",
  apiKey = "provider-secret",
): GenerateImageParams {
  return {
    prompt: "draw a quiet lake",
    negativePrompt: "noise",
    ratio: "16:9",
    resolution: "1K",
    quality: "high",
    apiKey,
    apiUrl: "https://custom.example/api/",
    model: "custom-image-v1",
    authMode,
    customManifest: manifest,
    operationType: "text-to-image",
  };
}

function getHeader(request: CapturedRequest, name: string) {
  return new Headers(request.init?.headers).get(name);
}

test("custom sync JSON requests render templates and extract wildcard URL results", async () => {
  const manifest = createSyncManifest();
  const { result, requests } = await withMockFetch(
    () =>
      Response.json({
        data: {
          items: [
            { url: "not-an-image-url" },
            { url: "https://cdn.example/generated.png" },
          ],
        },
      }),
    () => startCustomImageGeneration(createParams(manifest)),
  );

  assert.deepEqual(result, {
    type: "completed",
    output: "https://cdn.example/generated.png",
  });
  assert.equal(requests.length, 1);
  assert.equal(
    String(requests[0]?.input),
    "https://custom.example/api/v1/images/generate?response_format=json&requested_model=custom-image-v1",
  );
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests[0]?.init?.credentials, "omit");
  assert.equal(requests[0]?.init?.redirect, "error");
  assert.equal(requests[0]?.init?.referrerPolicy, "no-referrer");
  assert.equal(requests[0]?.init?.cache, "no-store");
  assert.equal(getHeader(requests[0]!, "content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    model: "custom-image-v1",
    prompt: "draw a quiet lake",
    negative_prompt: "noise",
    size: "1536x864",
    width: 1536,
    height: 864,
  });
});

test("custom sync requests fall back to base64 results", async () => {
  const { result } = await withMockFetch(
    () => Response.json({ data: { items: [{ b64: "aW1hZ2U=" }] } }),
    () => startCustomImageGeneration(createParams(createSyncManifest())),
  );

  assert.deepEqual(result, {
    type: "completed",
    output: "data:image/png;base64,aW1hZ2U=",
  });
});

test("custom requests support benchmark template variable aliases", async () => {
  const manifest = createSyncManifest();
  manifest.submit.generate.body = {
    model: "$profile.model",
    image_urls: "$inputImages.dataUrls",
    mask: "$mask.dataUrl",
    size: "$params.size",
    n: "$params.n",
  };
  const params = createParams(manifest);
  params.referenceImageUrls = ["data:image/png;base64,aW1hZ2U="];
  params.maskImageUrl = "data:image/png;base64,bWFzaw==";
  const { requests } = await withMockFetch(
    () =>
      Response.json({
        data: { items: [{ url: "https://cdn.example/image.png" }] },
      }),
    () => startCustomImageGeneration(params),
  );

  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    model: "custom-image-v1",
    image_urls: ["data:image/png;base64,aW1hZ2U="],
    mask: "data:image/png;base64,bWFzaw==",
    size: "1536x864",
    n: 1,
  });
});

test("custom requests emit only the selected controlled auth header", async () => {
  const cases: Array<{
    mode: ProviderAuthMode;
    apiKey: string;
    header: string | null;
    value: string | null;
  }> = [
    { mode: "none", apiKey: "", header: null, value: null },
    {
      mode: "bearer",
      apiKey: "bearer-secret",
      header: "authorization",
      value: "Bearer bearer-secret",
    },
    {
      mode: "x-api-key",
      apiKey: "x-secret",
      header: "x-api-key",
      value: "x-secret",
    },
    {
      mode: "api-key",
      apiKey: "api-secret",
      header: "api-key",
      value: "api-secret",
    },
  ];

  for (const authCase of cases) {
    const { requests } = await withMockFetch(
      () =>
        Response.json({
          data: { items: [{ url: "https://cdn.example/image.png" }] },
        }),
      () =>
        startCustomImageGeneration(
          createParams(createSyncManifest(), authCase.mode, authCase.apiKey),
        ),
    );
    const request = requests[0]!;
    assert.equal(
      getHeader(request, "authorization"),
      authCase.header === "authorization" ? authCase.value : null,
    );
    assert.equal(
      getHeader(request, "x-api-key"),
      authCase.header === "x-api-key" ? authCase.value : null,
    );
    assert.equal(
      getHeader(request, "api-key"),
      authCase.header === "api-key" ? authCase.value : null,
    );
  }
});

test("custom async submission extracts task IDs and GET polling normalizes statuses", async () => {
  const manifest = createPollingManifest("GET");
  const statuses: string[] = [];
  const { result, requests } = await withMockFetch(
    (_request, index) => {
      if (index === 0) return Response.json({ job: { id: " job/42 " } });
      if (index === 1) return Response.json({ job: { status: " Queued " } });
      return Response.json({
        job: {
          status: " succeeded ",
          outputs: [{ url: "https://cdn.example/async.png" }],
        },
      });
    },
    async () => {
      const params = createParams(manifest);
      const submission = await startCustomImageGeneration(params);
      assert.deepEqual(submission, {
        type: "remote",
        remoteTaskId: "job/42",
      });
      const output = await waitForCustomImageGeneration(
        params,
        submission.remoteTaskId,
        (status) => statuses.push(status),
      );
      return output;
    },
  );

  assert.equal(result, "https://cdn.example/async.png");
  assert.deepEqual(statuses, ["IN_PROGRESS", "SUCCESS"]);
  assert.equal(requests.length, 3);
  assert.equal(requests[1]?.init?.method, "GET");
  assert.equal(requests[1]?.init?.body, undefined);
  assert.equal(getHeader(requests[1]!, "accept"), "application/json");
  assert.equal(getHeader(requests[1]!, "content-type"), "application/json");
  assert.equal(
    String(requests[1]?.input),
    "https://custom.example/api/v1/tasks/job%2F42?task=job%2F42",
  );
});

test("custom async submission rejects a task ID outside configured taskIdPath", async () => {
  const manifest = createPollingManifest("GET");
  manifest.submit.generate.taskIdPath = "id";
  const { result: error } = await withMockFetch(
    () =>
      Response.json({ code: "success", data: { task_id: "nested-task-1" } }),
    async () => {
      try {
        await startCustomImageGeneration(createParams(manifest));
        return null;
      } catch (caught) {
        return caught;
      }
    },
  );
  assert.ok(error instanceof Error);
  assert.match(error.message, /taskIdPath/);
});

test("custom polling rejects a status outside configured statusPath", async () => {
  const manifest = createPollingManifest("GET");
  manifest.submit.generate.taskIdPath = "id";
  manifest.poll!.statusPath = "status";
  manifest.poll!.successValues = ["SUCCEEDED"];
  manifest.poll!.result = {
    imageUrlPaths: ["data.data.data.*.url"],
    base64Paths: [],
  };
  const { result: error } = await withMockFetch(
    () =>
      Response.json({
        data: {
          status: "SUCCESS",
          data: { data: [{ url: "https://cdn.example/apilio.png" }] },
        },
      }),
    async () => {
      try {
        await waitForCustomImageGeneration(
          createParams(manifest),
          "nested-task-1",
        );
        return null;
      } catch (caught) {
        return caught;
      }
    },
  );
  assert.ok(error instanceof Error);
  assert.match(error.message, /statusPath/);
});

test("custom polling accepts the shallow task result envelope", async () => {
  const manifest = createPollingManifest("GET");
  manifest.poll!.statusPath = "data.status";
  manifest.poll!.successValues = ["SUCCESS"];
  manifest.poll!.result = {
    imageUrlPaths: ["data.data.data.*.url"],
    base64Paths: ["data.data.data.*.b64_json"],
  };

  const { result } = await withMockFetch(
    () =>
      Response.json({
        task_id: "314c92d42f3e40f38897358cc87f02d8",
        data: {
          status: "SUCCESS",
          data: {
            data: [
              {
                url: "https://files.example/apilio-shallow.png",
                b64_json: "",
              },
            ],
          },
        },
      }),
    () =>
      waitForCustomImageGeneration(
        createParams(manifest),
        "314c92d42f3e40f38897358cc87f02d8",
      ),
  );

  assert.equal(result, "https://files.example/apilio-shallow.png");
});

test("custom POST polling sends the task ID and surfaces normalized failure details", async () => {
  const manifest = createPollingManifest("POST");
  const statuses: string[] = [];
  const { result: error, requests } = await withMockFetch(
    () =>
      Response.json({
        job: {
          status: " fAiLeD ",
          error: { message: "provider rejected the prompt" },
        },
      }),
    async () => {
      try {
        await waitForCustomImageGeneration(
          createParams(manifest, "x-api-key", "poll-secret"),
          "remote-9",
          (status) => statuses.push(status),
        );
        return null;
      } catch (caught) {
        return caught;
      }
    },
  );

  assert.ok(error instanceof Error);
  assert.match(error.message, /provider rejected the prompt/);
  assert.deepEqual(statuses, ["IN_PROGRESS", "FAILURE"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(getHeader(requests[0]!, "x-api-key"), "poll-secret");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    task_id: "remote-9",
  });
  assert.equal(
    String(requests[0]?.input),
    "https://custom.example/api/v1/tasks/remote-9?task=remote-9",
  );
});

test("custom polling surfaces JSON business errors instead of waiting forever", async () => {
  const manifest = createPollingManifest("GET");
  const { result: error } = await withMockFetch(
    () =>
      Response.json({
        error: {
          code: "invalid_request",
          message: "missing token",
          type: "new_api_error",
        },
      }),
    async () => {
      try {
        await waitForCustomImageGeneration(
          createParams(manifest),
          "remote-error",
        );
        return null;
      } catch (caught) {
        return caught;
      }
    },
  );

  assert.ok(error instanceof Error);
  assert.equal(error.message, "missing token");
});
