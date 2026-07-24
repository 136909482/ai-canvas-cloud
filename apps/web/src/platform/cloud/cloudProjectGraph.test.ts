import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import {
  applyProjectGraphOperationBatch,
  applyProjectGraphChanges,
  buildProjectGraphOperationBatches,
  canvasEdgeToProjectGraphEdge,
  canvasNodeToProjectGraphNode,
  diffCanvasSnapshots,
  doProjectGraphChangesOverlap,
  projectGraphEdgeToCanvasEdge,
  projectGraphNodeToCanvasNode,
} from "./cloudProjectGraph.ts";

test("cloud graph node mapping preserves relational and presentation fields", () => {
  const node: Node = {
    id: "node-child",
    type: "textNode",
    position: { x: 12, y: 24 },
    width: 320,
    height: 180,
    parentId: "node-parent",
    zIndex: 3,
    selected: false,
    extent: "parent",
    data: { text: "hello" },
  };

  const graphNode = canvasNodeToProjectGraphNode(node);
  const restored = projectGraphNodeToCanvasNode(graphNode);

  assert.equal(graphNode.parentNodeId, "node-parent");
  assert.deepEqual(graphNode.size, { width: 320, height: 180 });
  assert.equal(restored.parentId, "node-parent");
  assert.equal(restored.extent, "parent");
  assert.deepEqual(restored.data, { text: "hello" });
});

test("cloud graph edge mapping preserves animated presentation separately from endpoints", () => {
  const edge: Edge = {
    id: "edge-a-b",
    source: "node-a",
    target: "node-b",
    sourceHandle: "output",
    targetHandle: "input",
    animated: true,
    selected: false,
    data: { kind: "image" },
  };

  const graphEdge = canvasEdgeToProjectGraphEdge(edge);
  const restored = projectGraphEdgeToCanvasEdge(graphEdge);

  assert.equal(restored.animated, true);
  assert.equal(restored.sourceHandle, "output");
  assert.deepEqual(restored.data, { kind: "image" });
});

test("cloud graph diff emits only ID-level node and edge changes", () => {
  const baselineNode: Node = {
    id: "node-a",
    type: "textNode",
    position: { x: 0, y: 0 },
    data: { first: 1, second: 2 },
  };
  const movedNode: Node = {
    ...baselineNode,
    position: { x: 100, y: 0 },
    data: { second: 2, first: 1 },
  };
  const edge: Edge = {
    id: "edge-a-b",
    source: "node-a",
    target: "node-b",
    data: {},
  };

  assert.deepEqual(
    diffCanvasSnapshots(
      { nodes: [baselineNode], edges: [] },
      {
        nodes: [{ ...baselineNode, data: { second: 2, first: 1 } }],
        edges: [],
      },
    ),
    [],
  );

  const operations = diffCanvasSnapshots(
    { nodes: [baselineNode], edges: [edge] },
    { nodes: [movedNode], edges: [] },
  );

  assert.equal(operations.length, 2);
  assert.equal(operations[0]?.type, "upsertNode");
  assert.deepEqual(operations[1], { type: "deleteEdge", edgeId: "edge-a-b" });
});

test("cloud graph operation batching respects the server operation limit", () => {
  const operations = Array.from({ length: 1_001 }, (_, index) => ({
    type: "deleteEdge" as const,
    edgeId: `edge-${index}`,
  }));
  const batches = buildProjectGraphOperationBatches(
    { nodes: [], edges: [] },
    operations,
  );

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [500, 500, 1],
  );
});

test("cloud graph operation batching preserves node topology between chunks", () => {
  const baseline: { nodes: Node[]; edges: Edge[] } = {
    nodes: [
      {
        id: "parent",
        type: "groupNode",
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: "child",
        type: "textNode",
        position: { x: 10, y: 10 },
        parentId: "parent",
        data: {},
      },
    ],
    edges: [],
  };
  const upsertChild = {
    type: "upsertNode" as const,
    node: {
      id: "new-child",
      nodeType: "textNode",
      position: { x: 20, y: 20 },
      parentNodeId: "new-parent",
      dataSchemaVersion: 1,
      data: {},
    },
  };
  const upsertParent = {
    type: "upsertNode" as const,
    node: {
      id: "new-parent",
      nodeType: "groupNode",
      position: { x: 0, y: 0 },
      dataSchemaVersion: 1,
      data: {},
    },
  };
  const batches = buildProjectGraphOperationBatches(
    baseline,
    [
      upsertChild,
      upsertParent,
      { type: "deleteNode", nodeId: "parent" },
      { type: "deleteNode", nodeId: "child" },
    ],
    1,
  );

  assert.deepEqual(
    batches.map((batch) => batch[0]),
    [
      { type: "deleteNode", nodeId: "child" },
      { type: "deleteNode", nodeId: "parent" },
      upsertParent,
      upsertChild,
    ],
  );
});

test("cloud graph operation batches can be applied to advance the local baseline", () => {
  const baselineEdge: Edge = {
    id: "edge-a-b",
    source: "node-a",
    target: "node-b",
    data: {},
  };
  const baseline: { nodes: Node[]; edges: Edge[] } = {
    nodes: [
      { id: "node-a", type: "textNode", position: { x: 0, y: 0 }, data: {} },
      { id: "node-b", type: "textNode", position: { x: 100, y: 0 }, data: {} },
    ],
    edges: [baselineEdge],
  };
  const next = applyProjectGraphOperationBatch(baseline, [
    { type: "deleteNode", nodeId: "node-b" },
    {
      type: "upsertNode",
      node: {
        id: "node-c",
        nodeType: "textNode",
        position: { x: 200, y: 0 },
        dataSchemaVersion: 1,
        data: { text: "new" },
      },
    },
  ]);

  assert.deepEqual(
    next.nodes.map((node) => node.id),
    ["node-a", "node-c"],
  );
  assert.deepEqual(next.edges, []);
  assert.deepEqual(next.nodes.find((node) => node.id === "node-c")?.data, {
    text: "new",
  });
});

test("cloud graph change overlap detection is conservative around nodes and edges", () => {
  assert.equal(
    doProjectGraphChangesOverlap(
      [
        {
          type: "upsertNode",
          node: {
            id: "local",
            nodeType: "textNode",
            position: { x: 0, y: 0 },
            dataSchemaVersion: 1,
            data: {},
          },
        },
      ],
      [
        {
          sequence: 2,
          baseVersion: 1,
          resultVersion: 2,
          clientId: "browser_b",
          batchId: "remote_1",
          source: "user",
          operations: [
            {
              type: "upsertNode",
              node: {
                id: "remote",
                nodeType: "textNode",
                position: { x: 1, y: 1 },
                dataSchemaVersion: 1,
                data: {},
              },
            },
          ],
          createdAt: "2026-07-15T00:00:00.000Z",
        },
      ],
    ),
    false,
  );

  assert.equal(
    doProjectGraphChangesOverlap(
      [
        {
          type: "upsertEdge",
          edge: { id: "edge-local", source: "shared-node", target: "local" },
        },
      ],
      [
        {
          sequence: 3,
          baseVersion: 2,
          resultVersion: 3,
          clientId: "browser_b",
          batchId: "remote_2",
          source: "user",
          operations: [{ type: "deleteNode", nodeId: "shared-node" }],
          createdAt: "2026-07-15T00:00:01.000Z",
        },
      ],
    ),
    true,
  );
});

test("cloud graph changes can advance a baseline before retrying local operations", () => {
  const baseline: { nodes: Node[]; edges: Edge[] } = {
    nodes: [
      { id: "node-a", type: "textNode", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [],
  };
  const advanced = applyProjectGraphChanges(baseline, [
    {
      sequence: 2,
      baseVersion: 1,
      resultVersion: 2,
      clientId: "browser_b",
      batchId: "remote_1",
      source: "user",
      operations: [
        {
          type: "upsertNode",
          node: {
            id: "node-b",
            nodeType: "textNode",
            position: { x: 10, y: 20 },
            dataSchemaVersion: 1,
            data: { remote: true },
          },
        },
      ],
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    advanced.nodes.map((node) => node.id),
    ["node-a", "node-b"],
  );
  assert.deepEqual(advanced.nodes.find((node) => node.id === "node-b")?.data, {
    remote: true,
  });
});
