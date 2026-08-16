import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPOSED_SETTINGS_CATEGORY_IDS,
  useSettingsDialogStore,
} from "./useSettingsDialogStore.ts";

test("Vault and cloud task-record settings are exposed", () => {
  assert.deepEqual(EXPOSED_SETTINGS_CATEGORY_IDS, [
    "account",
    "community",
    "devices",
    "models",
    "storage",
    "canvas",
    "appearance",
    "tasks",
  ]);

  const store = useSettingsDialogStore.getState();
  assert.equal(store.activeCategory, "account");
  store.open("models");
  assert.equal(useSettingsDialogStore.getState().activeCategory, "models");
  store.setActiveCategory("tasks");
  assert.equal(useSettingsDialogStore.getState().activeCategory, "tasks");
  useSettingsDialogStore.getState().close();
});
