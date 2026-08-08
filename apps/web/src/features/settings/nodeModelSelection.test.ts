import assert from "node:assert/strict";
import test from "node:test";
import {
  getNodeModelIssueLabel,
  getNodeModelSelection,
  getPreferredSelectableModelEntryId,
  getSelectableModelGroups,
  getSelectableModels,
  getSelectableProviderProfiles,
  resolveNodeModelEntryId,
} from "./nodeModelSelection.ts";
import { normalizeConfig } from "@/store/settingsConfig.ts";

function createConfig() {
  return normalizeConfig({
    providerProfiles: [
      {
        id: "provider-a",
        name: "Provider A",
        protocol: "openai-compatible",
        authMode: "bearer",
        baseUrl: "https://a.example/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "provider-b",
        name: "Provider B",
        protocol: "openai-compatible",
        authMode: "bearer",
        baseUrl: "https://b.example/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    providerApiKeys: { "provider-a": "key-a", "provider-b": "key-b" },
    modelEntries: [
      {
        id: "entry-a",
        providerProfileId: "provider-a",
        modelId: "gpt-4o",
        displayName: "GPT A",
        category: "chat",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "entry-b",
        providerProfileId: "provider-b",
        modelId: "gpt-4o",
        displayName: "GPT B",
        category: "chat",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
}

test("two providers with the same upstream model remain separate selectable routes", () => {
  const config = createConfig();
  assert.deepEqual(
    getSelectableProviderProfiles(config, "chat").map((profile) => profile.id),
    ["provider-a", "provider-b"],
  );
  assert.deepEqual(
    getSelectableModels(config, "chat", "provider-a").map((entry) => entry.id),
    ["entry-a"],
  );
  assert.deepEqual(
    getSelectableModels(config, "chat", "provider-b").map((entry) => entry.id),
    ["entry-b"],
  );
  assert.deepEqual(
    getSelectableModelGroups(config, "chat").map((group) => ({
      modelId: group.modelId,
      routeIds: group.models.map((entry) => entry.id),
    })),
    [{ modelId: "gpt-4o", routeIds: ["entry-a", "entry-b"] }],
  );
});

test("preferred model uses the last selectable route and otherwise falls back to the first route", () => {
  const config = createConfig();
  assert.equal(getPreferredSelectableModelEntryId(config, "chat"), "entry-a");

  const withLastUsed = normalizeConfig({
    ...config,
    defaultModelEntryId: "entry-b",
  });
  assert.equal(
    getPreferredSelectableModelEntryId(withLastUsed, "chat"),
    "entry-b",
  );

  assert.equal(getPreferredSelectableModelEntryId(config, "image"), "");
});

test("preferred models are remembered independently for each category", () => {
  const config = createConfig();
  const withImageModel = normalizeConfig({
    ...config,
    lastUsedModelEntryIds: {
      chat: "entry-b",
      image: "entry-image",
      video: "entry-video",
    },
    modelEntries: [
      ...config.modelEntries,
      {
        id: "entry-image",
        providerProfileId: "provider-a",
        modelId: "gpt-image-2",
        displayName: "GPT Image",
        category: "image" as const,
        source: "manual" as const,
        status: "available" as const,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "entry-video",
        providerProfileId: "provider-b",
        modelId: "video-model-1",
        displayName: "Video Model",
        category: "video" as const,
        source: "manual" as const,
        status: "available" as const,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });

  assert.equal(
    getPreferredSelectableModelEntryId(withImageModel, "chat"),
    "entry-b",
  );
  assert.equal(
    getPreferredSelectableModelEntryId(withImageModel, "image"),
    "entry-image",
  );
  assert.equal(
    getPreferredSelectableModelEntryId(withImageModel, "video"),
    "entry-video",
  );
});

test("unbound, deleted, and upstream-missing references stay visible but cannot run", () => {
  const config = createConfig();
  const unbound = getNodeModelSelection(config, {
    category: "chat",
    reference: "local:11111111-1111-4111-8111-111111111111",
  });
  assert.equal(unbound.issue, "unbound");
  assert.equal(unbound.canExecute, false);
  assert.equal(getNodeModelIssueLabel(unbound), "未绑定");

  const deleted = getNodeModelSelection(config, {
    category: "chat",
    reference: "deleted-entry",
  });
  assert.equal(deleted.issue, "deleted");
  assert.equal(deleted.canExecute, false);
  assert.equal(getNodeModelIssueLabel(deleted), "已删除");

  const missingConfig = normalizeConfig({
    ...config,
    modelEntries: config.modelEntries.map((entry) =>
      entry.id === "entry-a" ? { ...entry, status: "missing" as const } : entry,
    ),
  });
  const missing = getNodeModelSelection(missingConfig, {
    category: "chat",
    reference: "entry-a",
  });
  assert.equal(missing.issue, "unavailable");
  assert.equal(getNodeModelIssueLabel(missing), "上游未找到");
  assert.equal(missing.canExecute, false);
});

test("a bound anonymous reference resolves only to its selected local model entry", () => {
  const reference = "local:11111111-1111-4111-8111-111111111111";
  const config = normalizeConfig({
    ...createConfig(),
    localModelBindings: { [reference]: "entry-b" },
  });

  assert.equal(resolveNodeModelEntryId(config, reference), "entry-b");
  const selection = getNodeModelSelection(config, {
    category: "chat",
    reference,
  });
  assert.equal(selection.selectedProvider?.id, "provider-b");
  assert.equal(selection.canExecute, true);
});
