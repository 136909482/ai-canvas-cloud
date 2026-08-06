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
    "interiorDesignNode",
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
  const generateRegistration = canvasNodeRegistrations.generateNode.manual;
  assert.ok(generateRegistration);
  const generateNode = generateRegistration.build(
    "generate-defaults",
    { x: 0, y: 0 },
    generateRegistration.size,
  );
  assert.equal(generateNode.data.ratio, "Auto");
  assert.deepEqual(canvasNodeRegistrations.textNode.manual?.size, {
    width: 280,
    height: 220,
  });
  assert.equal(getQuickCreateTargetHandle("generateNode"), "prompt");
  assert.equal(
    canvasNodeRegistrations.generateNode.outputLayout,
    "generated-preview",
  );
  const interiorRegistration = canvasNodeRegistrations.interiorDesignNode;
  assert.deepEqual(interiorRegistration.manual?.size, {
    width: 560,
    height: 620,
  });
  assert.equal(interiorRegistration.connection.output, "text");
  assert.equal(interiorRegistration.connection.inputs, undefined);
  assert.equal(interiorRegistration.outputLayout, "none");
  assert.equal(interiorRegistration.library?.label, "室内设计");
  assert.equal(
    nodeLibraryRegistrations.some(
      (registration) => registration.library.id === "text",
    ),
    true,
  );
});
