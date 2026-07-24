import assert from "node:assert/strict";
import test from "node:test";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import {
  validateListProjectRevisionsInput,
  validateCreateProjectCheckpointRequest,
  validateProjectRevisionVersion,
  validateRestoreProjectRevisionRequest,
} from "../../dist/modules/project-snapshots/service.js";

test("checkpoint request validation requires confirmed project version and sequence", () => {
  assert.deepEqual(
    validateCreateProjectCheckpointRequest({
      expectedVersion: 2,
      expectedSequence: 3,
    }),
    { expectedVersion: 2, expectedSequence: 3, checkpointType: "manual" },
  );
  assert.deepEqual(
    validateCreateProjectCheckpointRequest({
      expectedVersion: 2,
      expectedSequence: 3,
      checkpointType: "periodic",
    }),
    { expectedVersion: 2, expectedSequence: 3, checkpointType: "periodic" },
  );

  assert.throws(
    () =>
      validateCreateProjectCheckpointRequest({
        expectedVersion: -1,
        expectedSequence: 0,
      }),
    AuthServiceError,
  );
  assert.throws(
    () =>
      validateCreateProjectCheckpointRequest({
        expectedVersion: 0,
        expectedSequence: 1.5,
      }),
    AuthServiceError,
  );
  assert.throws(
    () =>
      validateCreateProjectCheckpointRequest({
        expectedVersion: 0,
        expectedSequence: 1,
        checkpointType: "import" as never,
      }),
    AuthServiceError,
  );
});

test("project revisions query validation normalizes pagination input", () => {
  assert.deepEqual(validateListProjectRevisionsInput({}), {
    cursor: null,
    limit: 20,
  });
  assert.deepEqual(
    validateListProjectRevisionsInput({ cursor: "cursor_1", limit: 2 }),
    {
      cursor: "cursor_1",
      limit: 2,
    },
  );

  assert.throws(
    () => validateListProjectRevisionsInput({ limit: 0 }),
    AuthServiceError,
  );
  assert.throws(
    () => validateListProjectRevisionsInput({ limit: 101 }),
    AuthServiceError,
  );
  assert.throws(
    () => validateListProjectRevisionsInput({ cursor: 1 as never }),
    AuthServiceError,
  );
});

test("project revision version validation accepts safe integers only", () => {
  assert.equal(validateProjectRevisionVersion("12"), 12);
  assert.equal(validateProjectRevisionVersion(0), 0);
  assert.throws(() => validateProjectRevisionVersion("-1"), AuthServiceError);
  assert.throws(() => validateProjectRevisionVersion("1.5"), AuthServiceError);
});

test("project revision restore validation requires confirmed project version and sequence", () => {
  assert.deepEqual(
    validateRestoreProjectRevisionRequest({
      expectedVersion: 4,
      expectedSequence: 5,
    }),
    { expectedVersion: 4, expectedSequence: 5 },
  );

  assert.throws(
    () =>
      validateRestoreProjectRevisionRequest({
        expectedVersion: -1,
        expectedSequence: 5,
      }),
    AuthServiceError,
  );
  assert.throws(
    () =>
      validateRestoreProjectRevisionRequest({
        expectedVersion: 4,
        expectedSequence: 5.5,
      }),
    AuthServiceError,
  );
});
