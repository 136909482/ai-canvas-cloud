import assert from "node:assert/strict";
import test from "node:test";
import { parseAccountErasureMaintenanceArgs } from "./maintain-account-erasures.mjs";

test("account erasure maintenance defaults to a read-only preflight", () => {
  assert.deepEqual(parseAccountErasureMaintenanceArgs([]), {
    help: false,
    apply: false,
    batchSize: 25,
  });
  assert.deepEqual(
    parseAccountErasureMaintenanceArgs(["--apply", "--batch-size=4"]),
    { help: false, apply: true, batchSize: 4 },
  );
  assert.throws(() => parseAccountErasureMaintenanceArgs(["--batch-size=0"]));
  assert.throws(() => parseAccountErasureMaintenanceArgs(["--unknown"]));
});
