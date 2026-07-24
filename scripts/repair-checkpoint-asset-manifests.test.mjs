import assert from "node:assert/strict";
import test from "node:test";
import { parseCheckpointAssetRepairArgs } from "./repair-checkpoint-asset-manifests.mjs";

test("checkpoint asset repair command is dry-run by default and validates its bounded batch size", () => {
  assert.deepEqual(parseCheckpointAssetRepairArgs([]), {
    help: false,
    apply: false,
    batchSize: 100,
  });
  assert.deepEqual(
    parseCheckpointAssetRepairArgs(["--apply", "--batch-size=25"]),
    {
      help: false,
      apply: true,
      batchSize: 25,
    },
  );
  assert.throws(() => parseCheckpointAssetRepairArgs(["--batch-size=0"]));
  assert.throws(() => parseCheckpointAssetRepairArgs(["--unknown"]));
});
