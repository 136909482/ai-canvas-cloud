import assert from "node:assert/strict";
import test from "node:test";
import {
  getSingleSelectedNodeId,
  shouldAnimateIncomingEdge,
} from "./incomingEdgeAnimation.ts";

test("single node selection identifies the incoming edge target", () => {
  assert.equal(
    getSingleSelectedNodeId([
      { id: "upstream" },
      { id: "selected", selected: true },
    ]),
    "selected",
  );
});

test("empty and multi-node selections do not animate incoming edges", () => {
  assert.equal(getSingleSelectedNodeId([{ id: "node" }]), null);
  assert.equal(
    getSingleSelectedNodeId([
      { id: "first", selected: true },
      { id: "second", selected: true },
    ]),
    null,
  );
});

test("only enabled edges entering the selected node animate", () => {
  assert.equal(
    shouldAnimateIncomingEdge({ target: "selected" }, "selected", true),
    true,
  );
  assert.equal(
    shouldAnimateIncomingEdge({ target: "other" }, "selected", true),
    false,
  );
  assert.equal(
    shouldAnimateIncomingEdge({ target: "selected" }, "selected", false),
    false,
  );
});
