import assert from "node:assert/strict";
import test from "node:test";
import { parseAssetMaintenanceArgs } from "./maintain-assets.mjs";

test("asset maintenance is read-only by default and bounds batch and grace options", () => {
  assert.deepEqual(parseAssetMaintenanceArgs([]), {
    help: false,
    apply: false,
    batchSize: 100,
    graceHours: 168,
  });
  assert.deepEqual(
    parseAssetMaintenanceArgs([
      "--apply",
      "--batch-size=25",
      "--grace-hours=48",
    ]),
    {
      help: false,
      apply: true,
      batchSize: 25,
      graceHours: 48,
    },
  );
  assert.throws(() => parseAssetMaintenanceArgs(["--batch-size=0"]));
  assert.throws(() => parseAssetMaintenanceArgs(["--grace-hours=0"]));
  assert.throws(() => parseAssetMaintenanceArgs(["--unknown"]));
});
