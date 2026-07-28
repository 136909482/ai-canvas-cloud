import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultImageEditorPreferences,
  normalizeImageEditorPreferences,
  readImageEditorPreferences,
  writeImageEditorPreferences,
} from "./preferences";

test("image editor preferences normalize invalid values to bounded defaults", () => {
  assert.deepEqual(
    normalizeImageEditorPreferences({
      schemaVersion: 1,
      annotation: {
        toolMode: "invalid",
        color: "javascript:alert(1)",
        brushSize: 10_000,
      },
      mask: {
        color: "#3b82f6",
        brushSize: -10,
      },
      textSize: Number.NaN,
    }),
    {
      schemaVersion: 1,
      annotation: {
        toolMode: "select",
        color: "#ef4444",
        brushSize: 96,
      },
      mask: {
        color: "#3b82f6",
        brushSize: 4,
      },
      textSize: 32,
    },
  );
});

test("image editor preferences persist independently for each account", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });

  try {
    const firstAccountPreferences = {
      ...createDefaultImageEditorPreferences(),
      annotation: {
        toolMode: "rect" as const,
        color: "#22c55e",
        brushSize: 48,
      },
      mask: {
        color: "#ffffff",
        brushSize: 72,
      },
      textSize: 64,
    };
    writeImageEditorPreferences("user/one", firstAccountPreferences);

    assert.deepEqual(
      readImageEditorPreferences("user/one"),
      firstAccountPreferences,
    );
    assert.deepEqual(
      readImageEditorPreferences("user/two"),
      createDefaultImageEditorPreferences(),
    );
    assert.equal(values.size, 1);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("image editor preferences ignore unsupported schema versions", () => {
  assert.deepEqual(
    normalizeImageEditorPreferences({ schemaVersion: 2 }),
    createDefaultImageEditorPreferences(),
  );
});
