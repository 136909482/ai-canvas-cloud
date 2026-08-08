import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOM_IMAGE_MANIFEST_MAX_BYTES,
  createCustomImageProviderImport,
  parseCustomImageProviderImportText,
  parseCustomImageProviderManifest,
} from "./customImageProviderManifest.ts";

function syncDefinition() {
  return {
    schemaVersion: 1,
    name: "Sync image API",
    executionMode: "sync",
    capabilities: { generate: true, edit: false },
    submit: {
      generate: {
        path: "v1/images/generations",
        method: "POST",
        contentType: "json",
        query: { format: "json" },
        body: {
          model: "$model",
          prompt: "$prompt",
          negativePrompt: "$negativePrompt",
          size: "$params.size",
          dimensions: {
            width: "$params.width",
            height: "$params.height",
          },
        },
        result: {
          imageUrlPaths: ["data.images.*.url", "data.output.0.url"],
          base64Paths: ["data.images.0.b64_json"],
        },
      },
    },
  };
}

function pollingDefinition() {
  return {
    schemaVersion: 1,
    name: "Async image API",
    executionMode: "polling",
    capabilities: { generate: true, edit: false },
    submit: {
      generate: {
        path: "v1/tasks",
        method: "POST",
        contentType: "multipart",
        files: [{ field: "image", source: "referenceImages", multiple: true }],
        body: { model: "$model", prompt: "$prompt" },
        taskIdPath: "task.id",
      },
    },
    poll: {
      path: "v1/tasks/status",
      method: "POST",
      query: { taskId: "$taskId" },
      body: { taskId: "$taskId" },
      intervalSeconds: 2,
      timeoutSeconds: 60,
      statusPath: "data.status",
      successValues: ["succeeded", "DONE"],
      failureValues: ["failed", "CANCELED"],
      errorPath: "data.error.message",
      result: {
        imageUrlPaths: ["data.images.0.url"],
      },
    },
  };
}

test("parses a synchronous manifest and normalizes paths/templates", () => {
  const manifest = parseCustomImageProviderManifest(syncDefinition(), {
    id: "manifest-sync",
    createdAt: 10,
    updatedAt: 11,
  });

  assert.equal(manifest.id, "manifest-sync");
  assert.equal(manifest.executionMode, "sync");
  assert.equal(manifest.submit.generate.path, "v1/images/generations");
  assert.deepEqual(manifest.submit.generate.result?.imageUrlPaths, [
    "data.images.*.url",
    "data.output.0.url",
  ]);
  assert.equal(manifest.submit.generate.body?.model, "$model");
  assert.equal(manifest.createdAt, 10);
});

test("parses polling manifests with multipart files and bounded polling", () => {
  const manifest = parseCustomImageProviderManifest(pollingDefinition(), {
    id: "manifest-async",
  });

  assert.equal(manifest.executionMode, "polling");
  assert.equal(manifest.submit.generate.contentType, "multipart");
  assert.equal(manifest.submit.generate.taskIdPath, "task.id");
  assert.deepEqual(manifest.submit.generate.files, [
    { field: "image", source: "referenceImages", multiple: true },
  ]);
  assert.equal(manifest.poll?.method, "POST");
  assert.equal(manifest.poll?.intervalSeconds, 2);
  assert.deepEqual(manifest.poll?.successValues, ["succeeded", "DONE"]);
});

test("rejects unknown fields and inconsistent sync/async definitions", () => {
  assert.throws(() =>
    parseCustomImageProviderManifest({ ...syncDefinition(), unexpected: true }),
  );

  const withUnknownBodyField = syncDefinition();
  (withUnknownBodyField.submit.generate as Record<string, unknown>).unknown =
    true;
  assert.throws(() => parseCustomImageProviderManifest(withUnknownBodyField));

  const syncWithPoll = { ...syncDefinition(), poll: pollingDefinition().poll };
  assert.throws(() => parseCustomImageProviderManifest(syncWithPoll));

  const asyncWithoutTaskId = pollingDefinition();
  delete (asyncWithoutTaskId.submit.generate as Record<string, unknown>)
    .taskIdPath;
  assert.throws(() => parseCustomImageProviderManifest(asyncWithoutTaskId));
});

test("rejects absolute, traversal, and dangerous paths", () => {
  for (const path of [
    "https://evil.example/task",
    "//evil.example/task",
    "/v1/images",
    "v1/../images",
    "%2e%2e/images",
    "v1/__proto__/images",
  ]) {
    const definition = syncDefinition();
    (definition.submit.generate as Record<string, unknown>).path = path;
    assert.throws(() => parseCustomImageProviderManifest(definition), path);
  }

  for (const resultPath of ["data.__proto__.url", "data.constructor.url"]) {
    const definition = syncDefinition();
    definition.submit.generate.result.imageUrlPaths = [resultPath];
    assert.throws(
      () => parseCustomImageProviderManifest(definition),
      resultPath,
    );
  }
});

test("rejects template variables outside the allowlist", () => {
  const definition = syncDefinition();
  (definition.submit.generate.body as Record<string, unknown>).secret =
    "$apiKey";
  assert.throws(() => parseCustomImageProviderManifest(definition), "$apiKey");
});

test("rejects imports containing API keys and oversized JSON", () => {
  const manifest = parseCustomImageProviderManifest(syncDefinition(), {
    id: "internal-id",
    createdAt: 1,
    updatedAt: 2,
  });
  const exportPackage = createCustomImageProviderImport(manifest, {
    providerName: "Example",
    baseUrl: "https://provider.example",
    authMode: "bearer",
  });

  const parsed = parseCustomImageProviderImportText(
    JSON.stringify(exportPackage),
  );
  assert.equal(parsed.manifest.name, "Sync image API");
  assert.equal("id" in parsed.manifest, false);

  const withKey = {
    ...exportPackage,
    defaults: { providerName: "Example", apiKey: "should-not-be-here" },
  };
  assert.throws(() =>
    parseCustomImageProviderImportText(JSON.stringify(withKey)),
  );

  const oversized = "x".repeat(CUSTOM_IMAGE_MANIFEST_MAX_BYTES);
  assert.ok(
    new TextEncoder().encode(oversized).byteLength >=
      CUSTOM_IMAGE_MANIFEST_MAX_BYTES,
  );
  assert.throws(() => parseCustomImageProviderImportText(oversized));
});

test("imports the benchmark customProviders/profiles shape", () => {
  const imported = parseCustomImageProviderImportText(
    JSON.stringify({
      customProviders: [
        {
          id: "custom-apilio",
          name: "Apilio",
          submit: {
            path: "images/generations",
            method: "POST",
            contentType: "json",
            query: { async: "true" },
            body: {
              model: "$profile.model",
              prompt: "$prompt",
              size: "$params.size",
            },
            taskIdPath: "data",
          },
          poll: {
            path: "images/tasks/{task_id}",
            method: "GET",
            intervalSeconds: 5,
            statusPath: "data.status",
            successValues: ["SUCCESS"],
            failureValues: ["FAILURE"],
            errorPath: "data.fail_reason",
            result: {
              imageUrlPaths: ["data.data.data.*.url"],
              b64JsonPaths: ["data.data.data.*.b64_json"],
            },
          },
        },
      ],
      profiles: [
        {
          name: "Apilio",
          provider: "custom-apilio",
          baseUrl: "https://api.apilio.ai/v1",
          model: "gpt-image-2",
          apiMode: "images",
        },
      ],
    }),
  );

  assert.equal(imported.manifest.name, "Apilio");
  assert.equal(imported.manifest.executionMode, "polling");
  assert.equal(imported.manifest.submit.generate.path, "images/generations");
  assert.equal(imported.manifest.submit.generate.body?.model, "$profile.model");
  assert.equal(imported.manifest.poll?.path, "images/tasks/{task_id}");
  assert.deepEqual(imported.defaults, {
    providerName: "Apilio",
    baseUrl: "https://api.apilio.ai/v1",
    suggestedModels: [{ modelId: "gpt-image-2" }],
  });
});

test("imports a bare current Manifest pasted into the editor", () => {
  const bareManifest = syncDefinition();
  const imported = parseCustomImageProviderImportText(
    JSON.stringify(bareManifest),
  );

  assert.equal(imported.manifest.name, "Sync image API");
  assert.equal(imported.manifest.submit.generate.path, "v1/images/generations");
  assert.equal("id" in imported.manifest, false);
});
