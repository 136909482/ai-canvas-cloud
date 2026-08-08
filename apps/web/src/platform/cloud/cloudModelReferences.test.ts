import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasSnapshot } from "@/types";
import { createLocalModelReference } from "@/features/settings/localModelReferences.ts";
import {
  hydrateCanvasLocalModelReferences,
  prepareCanvasForCloud,
} from "./cloudModelReferences.ts";

test("Cloud graph replaces private model identity and removes local task/provider state", () => {
  const reference = createLocalModelReference();
  const canvas: CanvasSnapshot = {
    nodes: [
      {
        id: "generate-1",
        type: "generateNode",
        position: { x: 0, y: 0 },
        data: {
          model: "private-image-model",
          apiProfileId: "private-provider-id",
          apiProfileName: "Private Provider",
          provider: "openai",
          protocol: "custom-http-image-v1",
          authMode: "bearer",
          customManifestId: "manifest-private-id",
          providerManifestVersion: 1,
          providerBindingFingerprint: "private-route-fingerprint",
          taskPhase: "polling",
          apiUrl: "https://provider.example/v1",
          apiKey: "private-key-value",
          activeTaskId: "task-1",
          status: "generating",
          errorMsg: "upstream private failure",
          prompt: "keep this prompt",
        },
      },
      {
        id: "video-result-1",
        type: "videoNode",
        position: { x: 100, y: 0 },
        data: { status: "error", errorMsg: "private video upstream response" },
      },
      {
        id: "llm-output-1",
        type: "llmOutputTextNode",
        position: { x: 200, y: 0 },
        data: { status: "error", errorMsg: "private chat upstream response" },
      },
    ],
    edges: [],
  };

  const cloud = prepareCanvasForCloud(canvas, (modelId) => {
    assert.equal(modelId, "private-image-model");
    return reference;
  });
  const data = cloud.nodes[0]?.data ?? {};

  assert.equal(data.model, reference);
  assert.equal(data.status, "idle");
  assert.equal(data.errorMsg, "");
  assert.equal(data.prompt, "keep this prompt");
  assert.equal("apiProfileName" in data, false);
  assert.equal("apiKey" in data, false);
  assert.equal("activeTaskId" in data, false);
  assert.equal("customManifestId" in data, false);
  assert.equal("providerBindingFingerprint" in data, false);
  assert.equal(JSON.stringify(cloud).includes("private-image-model"), false);
  assert.equal(JSON.stringify(cloud).includes("private-provider-id"), false);
  assert.equal(JSON.stringify(cloud).includes("private-key-value"), false);
  assert.equal(
    JSON.stringify(cloud).includes("private video upstream response"),
    false,
  );
  assert.equal(
    JSON.stringify(cloud).includes("private chat upstream response"),
    false,
  );
});

test("same-device hydration resolves aliases while another device keeps them unavailable", () => {
  const reference = createLocalModelReference();
  const cloud: CanvasSnapshot = {
    nodes: [
      {
        id: "llm-1",
        type: "llmNode",
        position: { x: 0, y: 0 },
        data: { model: reference },
      },
    ],
    edges: [],
  };

  const sameDevice = hydrateCanvasLocalModelReferences(cloud, (value) =>
    value === reference ? "private-chat-model" : null,
  );
  const otherDevice = hydrateCanvasLocalModelReferences(cloud, () => null);

  assert.equal(sameDevice.nodes[0]?.data.model, "private-chat-model");
  assert.equal(otherDevice.nodes[0]?.data.model, reference);
});

test("interior design prompt nodes do not participate in local model binding", () => {
  let createdReference = false;
  const cloud = prepareCanvasForCloud(
    {
      nodes: [
        {
          id: "interior-1",
          type: "interiorDesignNode",
          position: { x: 0, y: 0 },
          data: {
            compiledPrompt: '{"任务":"室内设计"}',
            config: { schemaVersion: 1 },
            outputTextNodeId: "text-1",
          },
        },
      ],
      edges: [],
    },
    () => {
      createdReference = true;
      return createLocalModelReference();
    },
  );

  const data = cloud.nodes[0]?.data ?? {};
  assert.equal(createdReference, false);
  assert.equal(data.compiledPrompt, '{"任务":"室内设计"}');
  assert.equal(data.outputTextNodeId, "text-1");
});
