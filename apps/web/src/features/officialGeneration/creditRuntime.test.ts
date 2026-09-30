import assert from "node:assert/strict";
import test from "node:test";
import {
  getCreditBalanceRuntime,
  resetCreditBalanceRuntime,
  setCreditBalanceRuntime,
} from "./creditRuntime.ts";

test("credit runtime keeps the latest server balance and clears per session", () => {
  resetCreditBalanceRuntime();
  setCreditBalanceRuntime({
    available: 10,
    reserved: 0,
    updatedAt: "2026-09-29T10:00:00.000Z",
  });
  setCreditBalanceRuntime({
    available: 9,
    reserved: 1,
    updatedAt: "2026-09-29T10:00:01.000Z",
  });
  setCreditBalanceRuntime({
    available: 10,
    reserved: 0,
    updatedAt: "2026-09-29T10:00:00.500Z",
  });

  assert.deepEqual(getCreditBalanceRuntime(), {
    available: 9,
    reserved: 1,
    updatedAt: "2026-09-29T10:00:01.000Z",
  });

  resetCreditBalanceRuntime();
  assert.equal(getCreditBalanceRuntime(), null);
});
