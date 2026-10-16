import assert from "node:assert/strict";
import test from "node:test";
import {
  getSingleSelectedNodeId,
  shouldAnimateConnectedEdge,
} from "./incomingEdgeAnimation.ts";

test("single node selection identifies the node whose connections animate", () => {
  assert.equal(
    getSingleSelectedNodeId([
      { id: "upstream" },
      { id: "selected", selected: true },
    ]),
    "selected",
  );
});

test("empty and multi-node selections do not animate connected edges", () => {
  for (const nodes of [
    [{ id: "node" }],
    [
      { id: "first", selected: true },
      { id: "second", selected: true },
    ],
  ]) {
    const selectedId = getSingleSelectedNodeId(nodes);
    assert.equal(selectedId, null);
    assert.equal(
      shouldAnimateConnectedEdge(
        { source: "first", target: "node" },
        selectedId,
        true,
      ),
      false,
    );
  }
});

test("only enabled edges directly entering or leaving the selected node animate", () => {
  const edges = [
    { source: "upstream", target: "selected" },
    { source: "selected", target: "downstream" },
    { source: "upstream-parent", target: "upstream" },
    { source: "downstream", target: "downstream-child" },
    { source: "unrelated", target: "other" },
  ];
  assert.deepEqual(
    edges.map((edge) => shouldAnimateConnectedEdge(edge, "selected", true)),
    [true, true, false, false, false],
  );
  assert.deepEqual(
    edges.map((edge) => shouldAnimateConnectedEdge(edge, "selected", false)),
    [false, false, false, false, false],
  );
});
