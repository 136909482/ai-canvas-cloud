import assert from "node:assert/strict";
import test from "node:test";
import { Position, type Handle, type InternalNode } from "@xyflow/react";
import { getCanvasBodyConnectionTarget } from "./canvasBodyConnection.ts";

function node(id: string, type: string): InternalNode {
  const userNode = { id, type, data: {}, position: { x: 200, y: 100 } };
  return {
    ...userNode,
    measured: { width: 180, height: 120 },
    internals: { positionAbsolute: userNode.position, z: 0, userNode },
  };
}

function handle(id: string, type: "source" | "target"): Handle {
  return {
    id,
    type,
    position: type === "source" ? Position.Right : Position.Left,
    x: type === "source" ? 180 : -20,
    y: 50,
    width: 20,
    height: 20,
    nodeId: "unused",
  };
}

test("body drops connect image and text outputs to the primary prompt at the border", () => {
  for (const type of ["generateNode", "imageNode", "textNode"]) {
    const target = getCanvasBodyConnectionTarget(
      node("source", type),
      handle("output", "source"),
      node("target", "generateNode"),
      [handle("image", "source"), handle("prompt", "target")],
    );
    assert.deepEqual(target?.connection, {
      source: "source",
      sourceHandle: "output",
      target: "target",
      targetHandle: "prompt",
    });
    assert.deepEqual(target?.point, { x: 200, y: 160 });
  }
});

test("multi-input nodes prefer the primary input rather than DOM order", () => {
  const target = getCanvasBodyConnectionTarget(
    node("source", "generateNode"),
    handle("image", "source"),
    node("edit", "imageEditNode"),
    [handle("reference", "target"), handle("base", "target")],
  );
  assert.equal(target?.connection.targetHandle, "base");
});

test("body drops filter incompatible inputs and fall back to an available input", () => {
  const source = node("source", "textNode");
  const start = handle("output", "source");
  const video = node("video", "videoGenerateNode");
  const target = getCanvasBodyConnectionTarget(source, start, video, [
    handle("image", "target"),
    handle("prompt", "target"),
  ]);
  assert.equal(target?.connection.targetHandle, "prompt");
  assert.equal(
    getCanvasBodyConnectionTarget(source, start, video, [
      handle("image", "target"),
    ]),
    null,
  );
  assert.equal(
    getCanvasBodyConnectionTarget(
      source,
      start,
      node("crop", "imageCropNode"),
      [handle("input", "target")],
    ),
    null,
  );
});

test("reverse dragging preserves direction and the original input handle", () => {
  const target = getCanvasBodyConnectionTarget(
    node("image", "generateNode"),
    handle("prompt", "target"),
    node("split", "inlineTextSplitterNode"),
    [
      handle("input", "target"),
      handle("part-0", "source"),
      handle("part-1", "source"),
    ],
  );
  assert.deepEqual(target?.connection, {
    source: "split",
    sourceHandle: "part-0",
    target: "image",
    targetHandle: "prompt",
  });
  assert.deepEqual(target?.point, { x: 380, y: 160 });
});

test("self, hidden, disabled, unknown and missing input targets cannot receive body drops", () => {
  const source = node("source", "generateNode");
  const start = handle("image", "source");
  const input = [handle("prompt", "target")];
  const target = node("target", "generateNode");
  for (const invalid of [
    source,
    { ...target, hidden: true },
    { ...target, connectable: false },
    node("group", "groupNode"),
    node("text", "textNode"),
  ]) {
    assert.equal(
      getCanvasBodyConnectionTarget(source, start, invalid, input),
      null,
    );
  }
  assert.equal(getCanvasBodyConnectionTarget(source, start, target, []), null);
  assert.equal(
    getCanvasBodyConnectionTarget(
      { ...source, hidden: true },
      start,
      target,
      input,
    ),
    null,
  );
  assert.equal(
    getCanvasBodyConnectionTarget(
      { ...source, connectable: false },
      start,
      target,
      input,
    ),
    null,
  );
});
