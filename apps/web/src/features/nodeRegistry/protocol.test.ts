import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasNodeRegistrations,
  getQuickCreateTargetHandle,
  nodeLibraryRegistrations,
} from "./protocol.ts";

test("node registration protocol covers all shared node types and compatibility aliases", () => {
  const requiredTypes: Array<keyof typeof canvasNodeRegistrations> = [
    "imageNode",
    "videoNode",
    "videoGenerateNode",
    "imageCropNode",
    "textNode",
    "textSplitterNode",
    "inlineTextSplitterNode",
    "generateNode",
    "imageEditNode",
    "experimentalGenerateNode",
    "generatedPreviewNode",
    "compareNode",
    "groupNode",
    "llmNode",
    "llmFileNode",
    "llmOutputTextNode",
    "testImageNode",
    "panoramaNode",
  ];
  for (const type of requiredTypes) {
    assert.ok(
      canvasNodeRegistrations[type],
      `missing registration for ${type}`,
    );
  }
  assert.equal(canvasNodeRegistrations.llmNode.rendererType, "llmFileNode");
  assert.equal(
    canvasNodeRegistrations.experimentalGenerateNode.rendererType,
    "generateNode",
  );
});

test("protocol owns manual factories, connection rules, output layouts, and library metadata", () => {
  assert.ok(canvasNodeRegistrations.generateNode.manual);
  assert.equal(getQuickCreateTargetHandle("generateNode"), "prompt");
  assert.equal(
    canvasNodeRegistrations.generateNode.outputLayout,
    "generated-preview",
  );
  assert.equal(
    nodeLibraryRegistrations.some(
      (registration) => registration.library.id === "text",
    ),
    true,
  );
});
