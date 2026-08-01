import assert from "node:assert/strict";
import test from "node:test";
import { confirmReturnHome } from "./canvasHomeNavigation.ts";

test("returning home skips confirmation when canvas changes are synchronized", async () => {
  let confirmationCount = 0;
  const allowed = await confirmReturnHome(false, async () => {
    confirmationCount += 1;
    return false;
  });

  assert.equal(allowed, true);
  assert.equal(confirmationCount, 0);
});

test("returning home confirms when canvas changes are not synchronized", async () => {
  const requests: unknown[] = [];
  const allowed = await confirmReturnHome(true, async (request) => {
    requests.push(request);
    return true;
  });

  assert.equal(allowed, true);
  assert.deepEqual(requests, [
    {
      title: "返回首页",
      message: "当前更改尚未同步到云端，返回首页可能丢失这些更改。",
      confirmLabel: "仍然返回",
      tone: "danger",
    },
  ]);
});

test("returning home stays on canvas when confirmation is cancelled", async () => {
  const allowed = await confirmReturnHome(true, async () => false);

  assert.equal(allowed, false);
});
