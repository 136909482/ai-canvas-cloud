import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualTextNode,
  buildTextSplitterOutputTextNode,
} from "@/store/canvasNodeCreation";
import { cloneNodeForDuplicate } from "@/store/canvasNodeClipboard";
import { selectSingleSelectedTextNode } from "@/store/canvasStoreSelectors";
import {
  EMPTY_TEXT_NODE_RUNTIME,
  isTextGenerationPanelOpen,
  useTextGenerationRuntime,
} from "./runtime";

test("only manually created empty text nodes automatically open AI", () => {
  const node = buildManualTextNode(
    "text",
    { x: 0, y: 0 },
    { width: 280, height: 220 },
  );
  assert.equal(
    isTextGenerationPanelOpen(node.data, EMPTY_TEXT_NODE_RUNTIME),
    true,
  );
  assert.equal(
    isTextGenerationPanelOpen({ text: "" }, EMPTY_TEXT_NODE_RUNTIME),
    false,
  );
  assert.equal(
    isTextGenerationPanelOpen(
      buildTextSplitterOutputTextNode("split", "", "split").data,
      EMPTY_TEXT_NODE_RUNTIME,
    ),
    false,
  );
  assert.equal(
    isTextGenerationPanelOpen(
      { ...node.data, generationMode: "text" },
      EMPTY_TEXT_NODE_RUNTIME,
    ),
    false,
  );
  assert.equal(
    isTextGenerationPanelOpen(
      { ...node.data, text: "generated" },
      EMPTY_TEXT_NODE_RUNTIME,
    ),
    false,
  );
});

test("explicit AI entry and dismissal override automatic visibility", () => {
  assert.equal(
    isTextGenerationPanelOpen(
      { text: "existing" },
      { ...EMPTY_TEXT_NODE_RUNTIME, panelOpen: true },
    ),
    true,
  );
  assert.equal(
    isTextGenerationPanelOpen(
      { text: "", generationMode: "ai" },
      { ...EMPTY_TEXT_NODE_RUNTIME, panelOpen: false },
    ),
    false,
  );
});

test("duplicated nodes keep content, prompt and model but never auto-open AI", () => {
  const node = buildManualTextNode(
    "text",
    { x: 0, y: 0 },
    { width: 280, height: 220 },
  );
  node.data.generationPrompt = "saved request";
  node.data.model = "local:binding";
  const duplicated = cloneNodeForDuplicate(node, [node], () => "copy");
  assert.equal(duplicated?.data.generationMode, "text");
  assert.equal(duplicated?.data.generationPrompt, "saved request");
  assert.equal(duplicated?.data.model, "local:binding");
});

test("multi-selection hides the text generation panel", () => {
  const node = buildManualTextNode(
    "text",
    { x: 0, y: 0 },
    { width: 280, height: 220 },
  );
  assert.equal(selectSingleSelectedTextNode({ nodes: [node] })?.id, "text");
  assert.equal(
    selectSingleSelectedTextNode({ nodes: [node, { ...node, id: "other" }] }),
    null,
  );
  assert.equal(
    selectSingleSelectedTextNode({ nodes: [{ ...node, selected: false }] }),
    null,
  );
});

test("session reset and node deletion remove all transient drafts and panel flags", () => {
  const store = useTextGenerationRuntime.getState();
  store.patch("one", {
    preview: "private draft",
    status: "running",
    panelOpen: true,
  });
  store.patch("two", { panelOpen: false });
  store.retainNodes(new Set(["two"]));
  assert.equal(useTextGenerationRuntime.getState().nodes.one, undefined);
  store.reset();
  assert.deepEqual(useTextGenerationRuntime.getState().nodes, {});
});
