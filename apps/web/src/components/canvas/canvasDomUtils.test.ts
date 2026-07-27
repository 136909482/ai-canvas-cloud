import assert from "node:assert/strict";
import test from "node:test";
import {
  CANVAS_NODE_DRAG_MIME_TYPE,
  hasCanvasNodeDragTransfer,
  isCanvasNodeDropTarget,
} from "./canvasDomUtils.ts";

test("allows node creation drops over existing canvas content but not controls", () => {
  const originalElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "Element",
  );

  class TestElement {
    private readonly isInsideCanvas: boolean;
    private readonly isCanvasControl: boolean;

    constructor(isInsideCanvas: boolean, isCanvasControl: boolean) {
      this.isInsideCanvas = isInsideCanvas;
      this.isCanvasControl = isCanvasControl;
    }

    closest(selector: string) {
      if (selector === ".react-flow") {
        return this.isInsideCanvas ? this : null;
      }

      return this.isCanvasControl ? this : null;
    }
  }

  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: TestElement,
  });

  try {
    assert.equal(
      isCanvasNodeDropTarget(
        new TestElement(true, false) as unknown as EventTarget,
      ),
      true,
    );
    assert.equal(
      isCanvasNodeDropTarget(
        new TestElement(true, true) as unknown as EventTarget,
      ),
      false,
    );
    assert.equal(
      isCanvasNodeDropTarget(
        new TestElement(false, false) as unknown as EventTarget,
      ),
      false,
    );
  } finally {
    if (originalElement) {
      Object.defineProperty(globalThis, "Element", originalElement);
    } else {
      Reflect.deleteProperty(globalThis, "Element");
    }
  }
});

test("recognizes only the dedicated canvas node drag payload", () => {
  const nodeTransfer = {
    types: ["text/plain", CANVAS_NODE_DRAG_MIME_TYPE],
  } as unknown as DataTransfer;
  const fileTransfer = {
    types: ["Files"],
  } as unknown as DataTransfer;

  assert.equal(hasCanvasNodeDragTransfer(nodeTransfer), true);
  assert.equal(hasCanvasNodeDragTransfer(fileTransfer), false);
  assert.equal(hasCanvasNodeDragTransfer(null), false);
});
