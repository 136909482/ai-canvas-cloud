import assert from "node:assert/strict";
import test from "node:test";
import { Position } from "@xyflow/react";
import {
  getToolbarTransform,
  isNodeInViewport,
  shouldShowNodeToolbar,
} from "./stableNodeToolbarGeometry";

test("a click opens node menus, dragging hides them, and stopping restores them without reselecting", () => {
  const base = { nodeInViewport: true, nodeIsDragging: false };
  for (const isVisible of [true, undefined]) {
    const show = (nodeIsDragging: boolean) =>
      shouldShowNodeToolbar({
        ...base,
        isVisible,
        selectedNodeCount: 1,
        nodeIsDragging,
      });
    assert.equal(show(false), true);
    assert.equal(show(true), false);
    assert.equal(show(false), true);
  }
  for (const selectedNodeCount of [0, 2]) {
    assert.equal(shouldShowNodeToolbar({ ...base, selectedNodeCount }), false);
  }
  assert.equal(
    shouldShowNodeToolbar({ ...base, isVisible: false, selectedNodeCount: 1 }),
    false,
  );
  assert.equal(
    shouldShowNodeToolbar({
      ...base,
      isVisible: true,
      selectedNodeCount: 1,
      nodeInViewport: false,
    }),
    false,
  );
});

test("the generation toolbar follows the image's lower edge through node movement and canvas zoom", () => {
  const node = { x: 100, y: 80, width: 360, height: 204 };
  assert.equal(
    getToolbarTransform(
      node,
      { x: 20, y: 30, zoom: 1 },
      Position.Bottom,
      12,
      "center",
    ),
    "translate(300px, 326px) translate(-50%, 0%)",
  );
  assert.equal(
    getToolbarTransform(
      { ...node, x: 200, y: 180 },
      { x: 20, y: 30, zoom: 1 },
      Position.Bottom,
      12,
      "center",
    ),
    "translate(400px, 426px) translate(-50%, 0%)",
  );
  assert.equal(
    getToolbarTransform(
      node,
      { x: -400, y: 30, zoom: 1 },
      Position.Bottom,
      12,
      "center",
    ),
    "translate(-120px, 326px) translate(-50%, 0%)",
  );
  // The node scales with the canvas; the panel and its 12 px gap stay readable.
  assert.equal(
    getToolbarTransform(
      node,
      { x: 20, y: 30, zoom: 0.5 },
      Position.Bottom,
      12,
      "center",
    ),
    "translate(160px, 184px) translate(-50%, 0%)",
  );
});

test("the generation panel hides when its node leaves any viewport edge and returns with the node", () => {
  const node = { x: 100, y: 80, width: 360, height: 204 };
  const viewportSize = { width: 953, height: 765 };
  const cases = [
    { edge: "left", outside: { x: -460, y: 0 }, inside: { x: -459, y: 0 } },
    { edge: "top", outside: { x: 0, y: -284 }, inside: { x: 0, y: -283 } },
    { edge: "right", outside: { x: 853, y: 0 }, inside: { x: 852, y: 0 } },
    { edge: "bottom", outside: { x: 0, y: 685 }, inside: { x: 0, y: 684 } },
  ];
  for (const { edge, outside, inside } of cases) {
    assert.equal(
      isNodeInViewport(node, { ...outside, zoom: 1 }, viewportSize),
      false,
      `hide at the ${edge} edge even if part of the wider panel could remain visible`,
    );
    assert.equal(
      isNodeInViewport(node, { ...inside, zoom: 1 }, viewportSize),
      true,
      `restore when the node reenters at the ${edge} edge`,
    );
  }
});

test("node visibility accounts for zoom, canvas resizing and initial measurement", () => {
  const node = { x: 100, y: 80, width: 360, height: 204 };
  const viewport = { x: -230, y: 0, zoom: 0.5 };
  const viewportSize = { width: 953, height: 765 };
  assert.equal(isNodeInViewport(node, viewport, viewportSize), false);
  assert.equal(
    isNodeInViewport(node, { ...viewport, zoom: 1 }, viewportSize),
    true,
  );
  assert.equal(
    isNodeInViewport(
      node,
      { x: 0, y: 0, zoom: 1 },
      { width: 100, height: 765 },
    ),
    false,
  );
  assert.equal(
    isNodeInViewport(
      node,
      { x: 0, y: 0, zoom: 1 },
      { width: 101, height: 765 },
    ),
    true,
  );
  assert.equal(
    isNodeInViewport({ ...node, width: 0 }, viewport, viewportSize),
    false,
  );
  assert.equal(
    isNodeInViewport(node, viewport, { width: 0, height: 0 }),
    false,
  );
});

test("existing image action toolbars retain their top and side anchors", () => {
  const node = { x: 100, y: 80, width: 360, height: 204 };
  const viewport = { x: 20, y: 30, zoom: 1 };
  assert.equal(
    getToolbarTransform(node, viewport, Position.Top, 10, "center"),
    "translate(300px, 100px) translate(-50%, -100%)",
  );
  assert.equal(
    getToolbarTransform(node, viewport, Position.Right, 10, "start"),
    "translate(490px, 110px) translate(0%, 0%)",
  );
  assert.equal(
    getToolbarTransform(node, viewport, Position.Left, 10, "end"),
    "translate(110px, 314px) translate(-100%, -100%)",
  );
});
