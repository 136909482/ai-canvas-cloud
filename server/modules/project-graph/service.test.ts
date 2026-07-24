import assert from "node:assert/strict";
import test from "node:test";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import {
  PROJECT_GRAPH_MAX_OPERATIONS,
  validateApplyProjectGraphOperationsRequest,
  validateProjectGraphChangesAfter,
} from "../../dist/modules/project-graph/service.js";

function validRequest() {
  return {
    baseVersion: 0,
    clientId: "browser_1",
    batchId: "batch_1",
    idempotencyKey: "graph_1",
    operations: [
      {
        type: "upsertNode" as const,
        node: {
          id: "node_1",
          nodeType: "text",
          position: { x: 10, y: 20 },
          dataSchemaVersion: 1,
          data: {},
        },
      },
    ],
  };
}

test("graph request validation normalizes optional relational fields", () => {
  const result = validateApplyProjectGraphOperationsRequest(validRequest());
  const operation = result.operations[0];

  assert(operation?.type === "upsertNode");
  assert.equal(operation.node.parentNodeId, null);
  assert.equal(result.baseVersion, 0);
});

test("graph request validation rejects duplicate entities and invalid bounds", () => {
  const duplicate = validRequest();
  duplicate.operations.push({ ...duplicate.operations[0]! });

  assert.throws(
    () => validateApplyProjectGraphOperationsRequest(duplicate),
    AuthServiceError,
  );
  assert.throws(
    () =>
      validateApplyProjectGraphOperationsRequest({
        ...validRequest(),
        baseVersion: -1,
      }),
    AuthServiceError,
  );
  assert.throws(
    () =>
      validateApplyProjectGraphOperationsRequest({
        ...validRequest(),
        operations: Array.from(
          { length: PROJECT_GRAPH_MAX_OPERATIONS + 1 },
          (_, index) => ({
            type: "deleteNode" as const,
            nodeId: `node_${index}`,
          }),
        ),
      }),
    AuthServiceError,
  );
});

test("graph request validation rejects invalid geometry and edge data", () => {
  assert.throws(
    () =>
      validateApplyProjectGraphOperationsRequest({
        ...validRequest(),
        operations: [
          {
            type: "upsertNode",
            node: {
              ...validRequest().operations[0]!.node,
              position: { x: Number.NaN, y: 0 },
            },
          },
        ],
      }),
    AuthServiceError,
  );
  assert.throws(
    () =>
      validateApplyProjectGraphOperationsRequest({
        ...validRequest(),
        operations: [
          {
            type: "upsertEdge",
            edge: {
              id: "edge_1",
              source: "node_1",
              target: "node_2",
              data: [],
            },
          },
        ],
      } as never),
    AuthServiceError,
  );
});

test("graph changes query validation accepts omitted after and rejects invalid sequences", () => {
  assert.equal(validateProjectGraphChangesAfter(undefined), 0);
  assert.equal(validateProjectGraphChangesAfter("12"), 12);
  assert.throws(() => validateProjectGraphChangesAfter("-1"), AuthServiceError);
  assert.throws(
    () => validateProjectGraphChangesAfter("1.5"),
    AuthServiceError,
  );
});
