import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import { canvasNodeRegistrations } from "@/features/nodeRegistry/protocol";
import type { ImportedImageResult } from "@/features/imageImport/runtime";
import { getGenerateReferenceSourceNodes } from "@/store/canvasConnectionSources";
import { selectSingleSelectedGenerateNode } from "@/store/canvasStoreSelectors";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { syncSourceNodeAfterTaskSettles } from "@/features/generateQueue/taskCanvasState";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import type { GenerateTask } from "@/types";
import {
  buildUploadedImageGraph,
  getGeneratedImageCardSize,
  getInlineImageResultIds,
} from "./imageNodePresentation";

const registration = canvasNodeRegistrations.generateNode.manual!;
function createImage(id: string): Node {
  return registration.build(id, { x: 120, y: 80 }, registration.size);
}
const upload: ImportedImageResult = {
  imageUrl: "https://assets.example/upload.png",
  imageAsset: null,
  name: "参考图.png",
  naturalWidth: 1280,
  naturalHeight: 720,
  width: 360,
  height: 203,
};

test("generated image frames fit square, landscape and portrait images at the current width", () => {
  assert.deepEqual(getGeneratedImageCardSize(1024, 1024, 360), {
    width: 360,
    height: 360,
  });
  for (const [width, height] of [
    [1536, 1024],
    [1024, 1536],
    [2048, 768],
    [768, 2048],
  ]) {
    const size = getGeneratedImageCardSize(width, height, 360);
    assert.ok(size);
    assert.ok(
      Math.abs((size.width - 2) / (size.height - 2) - width / height) < 0.01,
    );
    assert.ok(size.width <= 900 && size.height <= 900);
  }
});

test("tall generated frames scale both dimensions to fit and invalid metadata leaves geometry unchanged", () => {
  const tall = getGeneratedImageCardSize(512, 2048, 900);
  assert.ok(tall);
  assert.equal(tall.height, 900);
  assert.ok(tall.width < 900);
  assert.ok(Math.abs((tall.height - 2) / (tall.width - 2) - 4) < 0.01);
  assert.equal(getGeneratedImageCardSize(0, 1024), null);
  assert.equal(getGeneratedImageCardSize(1024, Number.NaN), null);
  assert.equal(getGeneratedImageCardSize(Number.POSITIVE_INFINITY, 1024), null);
  assert.deepEqual(getGeneratedImageCardSize(1024, 1024, Number.NaN), {
    width: 360,
    height: 360,
  });
});

test("upload replaces the empty card in place with a source image and closes its generation panel", () => {
  const source = createImage("source");
  const target = { ...createImage("target"), selected: false };
  const text: Node = {
    id: "text",
    type: "textNode",
    position: { x: 0, y: 0 },
    data: { text: "旧提示词" },
  };
  const edges: Edge[] = [
    {
      id: "prompt",
      source: "text",
      target: "source",
      sourceHandle: "output",
      targetHandle: "prompt",
    },
    {
      id: "reference",
      source: "source",
      target: "target",
      sourceHandle: "image",
      targetHandle: "prompt",
    },
  ];
  const result = buildUploadedImageGraph(
    [source, target, text],
    edges,
    source.id,
    upload,
  );
  assert.ok(result);
  const uploaded = result.nodes[0];
  assert.equal(uploaded.id, source.id);
  assert.equal(uploaded.type, "imageNode");
  assert.deepEqual(uploaded.position, source.position);
  assert.equal(uploaded.selected, true);
  assert.equal(uploaded.data.imageUrl, upload.imageUrl);
  assert.equal(uploaded.data.imageNaturalWidth, 1280);
  assert.equal(uploaded.width, upload.width);
  assert.equal(uploaded.height, upload.height);
  assert.equal(selectSingleSelectedGenerateNode(result), null);
  assert.deepEqual(result.edges, [{ ...edges[1], sourceHandle: "output" }]);
  assert.deepEqual(result.nodes[1].data.referenceSourceOrder, ["source"]);
  assert.deepEqual(getGenerateReferenceSourceNodes(result.nodes, "target"), [
    uploaded,
  ]);
  assert.equal(source.type, "generateNode");
  assert.deepEqual(edges[1].sourceHandle, "image");
});

test("a completed upload cannot overwrite a deleted, changed, busy or already populated card", () => {
  assert.equal(buildUploadedImageGraph([], [], "source", upload), null);
  const source = createImage("source");
  for (const data of [
    { status: "queued" },
    { status: "generating" },
    { imageUrl: "existing.png" },
  ]) {
    assert.equal(
      buildUploadedImageGraph(
        [{ ...source, data: { ...source.data, ...data } }],
        [],
        "source",
        upload,
      ),
      null,
    );
  }
  assert.equal(
    buildUploadedImageGraph(
      [{ ...source, type: "imageNode" }],
      [],
      "source",
      upload,
    ),
    null,
  );
});

test("upload conversion and connected edges undo together through the existing history", () => {
  const original = useCanvasStore.getState();
  try {
    const source = createImage("source");
    useCanvasStore.setState({ nodes: [source], edges: [] });
    useHistoryStore.getState().clearHistory();
    const result = buildUploadedImageGraph([source], [], source.id, upload);
    assert.ok(result);
    useHistoryStore
      .getState()
      .runTracked(() => useCanvasStore.setState(result));
    assert.equal(useCanvasStore.getState().nodes[0].type, "imageNode");
    useHistoryStore.getState().undo();
    assert.deepEqual(useCanvasStore.getState().nodes, [
      { ...source, selected: false },
    ]);
    useHistoryStore.getState().redo();
    assert.equal(
      useCanvasStore.getState().nodes[0].data.imageUrl,
      upload.imageUrl,
    );
  } finally {
    useHistoryStore.getState().clearHistory();
    useCanvasStore.setState({ nodes: original.nodes, edges: original.edges });
  }
});

test("generated image cards connect to the next empty card before and after receiving a result", () => {
  const original = useCanvasStore.getState();
  try {
    useCanvasStore.setState({
      nodes: [
        createImage("source"),
        { ...createImage("target"), selected: false },
      ],
      edges: [],
    });
    const store = useCanvasStore.getState();
    store.onConnect({
      source: "source",
      sourceHandle: "image",
      target: "target",
      targetHandle: "prompt",
    });
    assert.deepEqual(
      useCanvasStore.getState().nodes[1].data.referenceSourceOrder,
      ["source"],
    );
    assert.deepEqual(
      getGenerateReferenceSourceNodes(
        useCanvasStore.getState().nodes,
        "target",
      ),
      [],
    );
    store.updateNodeData("source", {
      imageUrl: "generated.png",
      status: "done",
    });
    const references = getGenerateReferenceSourceNodes(
      useCanvasStore.getState().nodes,
      "target",
    );
    assert.equal(references.length, 1);
    assert.equal(references[0].data.imageUrl, "generated.png");
    store.updateNodeData("source", { imageUrl: "regenerated.png" });
    assert.equal(
      getGenerateReferenceSourceNodes(
        useCanvasStore.getState().nodes,
        "target",
      )[0].data.imageUrl,
      "regenerated.png",
    );
  } finally {
    useCanvasStore.setState({ nodes: original.nodes, edges: original.edges });
  }
});

function preview(id: string, data: Node["data"] = {}): Node {
  return {
    id,
    type: "generatedPreviewNode",
    position: { x: 600, y: 80 },
    data: {
      sourceGenerateNodeId: "source",
      layoutMode: "auto",
      status: "done",
      imageUrl: "latest.png",
      ...data,
    },
  };
}

test("inline results hide duplicate images regardless of layout, preserving distinct history and used results", () => {
  const source = {
    ...createImage("source"),
    data: { imageUrl: "latest.png", outputCount: 2 },
  };
  const nodes = [
    source,
    preview("duplicate"),
    preview("history", { imageUrl: "older.png" }),
    preview("queued", { imageUrl: "", status: "queued" }),
    preview("manual", { layoutMode: "manual" }),
    preview("manual-history", { layoutMode: "manual", imageUrl: "older.png" }),
    preview("manual-empty", {
      layoutMode: "manual",
      imageUrl: "",
      status: "queued",
    }),
    { ...preview("selected"), selected: true },
    preview("used"),
    preview("orphan", { sourceGenerateNodeId: "deleted" }),
    { ...preview("grouped"), parentId: "group" },
  ];
  const edges: Edge[] = [{ id: "used-edge", source: "used", target: "next" }];
  assert.deepEqual(
    [...getInlineImageResultIds(nodes, edges)],
    ["duplicate", "queued", "manual"],
  );
  assert.ok(nodes.every((node) => node.hidden === undefined));
  assert.deepEqual([...getInlineImageResultIds(nodes.slice(1), edges)], []);
});

test("single-image generation stays inline for old and new results regardless of movement or selection", () => {
  const source = { ...createImage("source"), data: { imageUrl: "latest.png" } };
  const nodes = [
    source,
    preview("latest"),
    preview("old", { imageUrl: "older.png" }),
    preview("moved", { imageUrl: "older.png", layoutMode: "manual" }),
    { ...preview("selected", { imageUrl: "older.png" }), selected: true },
    preview("queued", { imageUrl: "", status: "queued" }),
    preview("failed", { imageUrl: "", status: "error" }),
    preview("batch", { resultDisplay: "canvas", imageUrl: "batch.png" }),
    preview("used", { imageUrl: "older.png" }),
    { ...preview("grouped", { imageUrl: "older.png" }), parentId: "group" },
    preview("orphan", { sourceGenerateNodeId: "deleted" }),
  ];
  assert.deepEqual(
    [
      ...getInlineImageResultIds(nodes, [
        { id: "used-edge", source: "used", target: "next" },
      ]),
    ],
    ["latest", "old", "moved", "selected", "queued", "failed"],
  );
  const inline = preview("inline", {
    resultDisplay: "inline",
    imageUrl: "older.png",
  });
  assert.deepEqual(
    [
      ...getInlineImageResultIds(
        [{ ...source, data: { ...source.data, outputCount: 4 } }, inline],
        [],
      ),
    ],
    ["inline"],
  );
});

test("asset identity recognizes a mirrored result after image URLs have been restored", () => {
  const source = {
    ...createImage("source"),
    data: {
      imageUrl: "blob:restored-source",
      outputCount: 2,
      imageAsset: { relativePath: "assets/result.png" },
    },
  };
  const result = preview("result", {
    imageUrl: "blob:restored-result",
    imageAsset: { relativePath: "assets/result.png" },
  });
  assert.deepEqual(
    [...getInlineImageResultIds([source, result], [])],
    ["result"],
  );
});

test("existing task settlement mirrors the completed image into the original card", () => {
  const originalCanvas = useCanvasStore.getState();
  const originalTasks = useTaskQueueStore.getState().tasks;
  try {
    const task = {
      id: "task",
      sourceNodeId: "source",
      previewNodeId: "result",
      status: "done",
      createdAt: 1,
    } as GenerateTask;
    useCanvasStore.setState({
      nodes: [createImage("source"), preview("result")],
      edges: [],
    });
    useTaskQueueStore.setState({ tasks: [task] });
    syncSourceNodeAfterTaskSettles(task, {
      status: "done",
      imageUrl: "latest.png",
    });
    const source = useCanvasStore.getState().nodes[0];
    assert.equal(source.id, "source");
    assert.equal(source.type, "generateNode");
    assert.equal(source.data.imageUrl, "latest.png");
    assert.equal(source.data.status, "done");
  } finally {
    useCanvasStore.setState({
      nodes: originalCanvas.nodes,
      edges: originalCanvas.edges,
    });
    useTaskQueueStore.setState({ tasks: originalTasks });
  }
});
