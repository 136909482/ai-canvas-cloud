import assert from "node:assert/strict";
import test from "node:test";
import { getImageGenerationProgress } from "./imageProgressEstimate";

const startedAt = 100_000;
const running = {
  status: "running" as const,
  phase: "requesting" as const,
  startedAt,
  resolution: "1K",
};

test("queued tasks stay at zero without counting queue time as generation", () => {
  const progress = getImageGenerationProgress(
    { ...running, status: "queued", phase: null, startedAt: 0 },
    startedAt + 600_000,
  );
  assert.equal(progress.percent, 0);
  assert.equal(progress.label, "排队中");
  assert.equal(progress.elapsedSeconds, null);
  assert.equal(progress.estimated, false);
});

test("estimated image progress rises with elapsed time and never reaches completion early", () => {
  for (const resolution of ["1K", "2K", "4K"]) {
    let previous = 0;
    for (const elapsed of [0, 1000, 10_000, 60_000, 300_000, 3_600_000]) {
      const progress = getImageGenerationProgress(
        { ...running, resolution },
        startedAt + elapsed,
      );
      assert.ok(progress.percent !== null);
      assert.ok(progress.percent >= previous);
      assert.ok(progress.percent < 100);
      assert.equal(progress.estimated, true);
      assert.equal(progress.elapsedSeconds, elapsed / 1000);
      previous = progress.percent;
    }
  }
});

test("remote polling keeps the original elapsed time when it waits to resume", () => {
  const resumed = getImageGenerationProgress(
    {
      ...running,
      status: "queued",
      phase: "polling",
      startedAt: 0,
      telemetryStartedAt: startedAt,
    },
    startedAt + 60_000,
  );
  const uninterrupted = getImageGenerationProgress(running, startedAt + 60_000);
  assert.deepEqual(resumed, uninterrupted);
});

test("saving advances beyond generation, and only successful tasks reach 100", () => {
  const now = startedAt + 3_600_000;
  const generating = getImageGenerationProgress(running, now);
  const saving = getImageGenerationProgress(
    { ...running, phase: "persisting" },
    now,
  );
  assert.ok(saving.percent! > generating.percent!);
  assert.ok(saving.percent! < 100);
  assert.equal(saving.label, "正在保存图片");
  const done = getImageGenerationProgress({ ...running, status: "done" }, now);
  assert.equal(done.percent, 100);
  assert.equal(done.estimated, false);
  const failed = getImageGenerationProgress(
    { ...running, status: "error" },
    now,
  );
  assert.equal(failed.percent, null);
  assert.equal(failed.label, "生成失败");
});

test("legacy missing tasks remain indeterminate and retries reset their estimate", () => {
  assert.equal(getImageGenerationProgress(undefined, startedAt).percent, null);
  assert.equal(
    getImageGenerationProgress(undefined, startedAt, true).percent,
    0,
  );
  const retried = getImageGenerationProgress(
    { ...running, startedAt: startedAt + 60_000, telemetryStartedAt: null },
    startedAt + 60_000,
  );
  assert.equal(retried.elapsedSeconds, 0);
  assert.ok(
    retried.percent! <
      getImageGenerationProgress(running, startedAt + 60_000).percent!,
  );
  const clockSkew = getImageGenerationProgress(running, startedAt - 1000);
  assert.equal(clockSkew.elapsedSeconds, 0);
  assert.ok(clockSkew.percent! >= 0);
});
