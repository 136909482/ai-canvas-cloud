import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { Position } from "@xyflow/react";
import {
  ArrowUp,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Square,
} from "lucide-react";
import { StableNodeToolbar } from "@/components/StableNodeToolbar";
import { useAuthStore } from "@/features/auth/useAuthStore";
import { GenerationPromptDialog } from "@/features/canvasGeneration/GenerationPromptDialog";
import { RichPromptEditor } from "@/features/richPrompt/RichPromptEditor";
import { createRichPromptDocumentFromText } from "@/features/richPrompt/promptCompiler";
import type { RichPromptReferenceItem } from "@/features/richPrompt/types";
import {
  getNodeModelIssueLabel,
  getNodeModelSelection,
} from "@/features/settings/nodeModelSelection";
import {
  generateTextNode,
  resetTextGenerationRuntime,
  textGenerationRunner,
} from "@/features/textGeneration/orchestrator";
import {
  EMPTY_TEXT_NODE_RUNTIME,
  isTextGenerationPanelOpen,
  useTextGenerationRuntime,
} from "@/features/textGeneration/runtime";
import { NodeModelSelector } from "@/nodes/NodeModelSelector";
import { selectSingleSelectedTextNode } from "@/store/canvasStoreSelectors";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { themeClasses } from "@/styles/themeClasses";
import type { AppNode } from "@/types";

const TEXT_PROMPT_REFERENCES: RichPromptReferenceItem[] = [];

export function CanvasTextGenerationBar() {
  const node = useCanvasStore(selectSingleSelectedTextNode);
  const runtime = useTextGenerationRuntime((state) =>
    node
      ? (state.nodes[node.id] ?? EMPTY_TEXT_NODE_RUNTIME)
      : EMPTY_TEXT_NODE_RUNTIME,
  );
  useEffect(() => {
    const unsubscribeCanvas = useCanvasStore.subscribe((state, previous) => {
      textGenerationRunner.cancelInvalidated();
      if (state.nodes.length !== previous.nodes.length)
        useTextGenerationRuntime
          .getState()
          .retainNodes(new Set(state.nodes.map((candidate) => candidate.id)));
    });
    const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
      if (state.activeProjectId !== previous.activeProjectId)
        resetTextGenerationRuntime();
    });
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (
        state.session?.user.id !== previous.session?.user.id ||
        state.session?.workspace.id !== previous.session?.workspace.id
      )
        resetTextGenerationRuntime();
    });
    return () => {
      unsubscribeCanvas();
      unsubscribeProject();
      unsubscribeAuth();
      resetTextGenerationRuntime();
    };
  }, []);
  return node && isTextGenerationPanelOpen(node.data, runtime) ? (
    <TextGenerationPanel key={node.id} node={node} />
  ) : null;
}

function TextGenerationPanel({ node }: { node: AppNode<"textNode"> }) {
  const runtime = useTextGenerationRuntime(
    (state) => state.nodes[node.id] ?? EMPTY_TEXT_NODE_RUNTIME,
  );
  const config = useSettingsStore((state) => state.config);
  const editingPrompt = useRef(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const selection = getNodeModelSelection(config, {
    category: "chat",
    reference: node.data.model,
  });
  const running = runtime.status === "running";
  const prompt = node.data.generationPrompt ?? "";
  const promptDocument = useMemo(
    () => createRichPromptDocumentFromText(prompt),
    [prompt],
  );
  const issue =
    runtime.error ||
    (selection.issue !== "unbound" ? getNodeModelIssueLabel(selection) : "");
  const commitPrompt = () => {
    if (!editingPrompt.current) return;
    editingPrompt.current = false;
    useHistoryStore.getState().commitTransaction();
  };
  useEffect(
    () => () => {
      if (editingPrompt.current) useHistoryStore.getState().commitTransaction();
    },
    [],
  );
  const stopGesture = (event: SyntheticEvent) => event.stopPropagation();
  const closePromptEditor = () => {
    commitPrompt();
    setPromptExpanded(false);
    window.requestAnimationFrame(() =>
      expandButtonRef.current?.focus({ preventScroll: true }),
    );
  };
  const panel = (
    <section
      data-testid="canvas-text-generation-bar"
      data-node-id={node.id}
      data-expanded={promptExpanded}
      aria-label="文本生成面板"
      className={`canvas-generation-panel flex flex-col rounded-2xl border border-[var(--floating-panel-border)] bg-[var(--floating-panel-bg)] text-[var(--text-primary)] shadow-[0_8px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl ${promptExpanded ? "h-full w-full p-3 sm:p-4" : "w-[658px] max-w-[calc(100vw-24px)] p-3"}`}
      onPointerDown={stopGesture}
      onMouseDown={stopGesture}
      onClick={stopGesture}
      onDoubleClick={stopGesture}
      onKeyDown={(event) => {
        if (!promptExpanded || (event.key !== "Tab" && event.key !== "Escape"))
          event.stopPropagation();
        if (!promptExpanded && event.key === "Escape") {
          commitPrompt();
          useTextGenerationRuntime
            .getState()
            .patch(node.id, { panelOpen: false });
        }
      }}
    >
      <div className="mb-2 flex shrink-0 items-center justify-end">
        <button
          ref={expandButtonRef}
          type="button"
          aria-label={promptExpanded ? "收起生成面板" : "放大编辑文本生成需求"}
          title={
            promptExpanded ? "收起生成面板（Esc）" : "放大编辑文本生成需求"
          }
          aria-haspopup={promptExpanded ? undefined : "dialog"}
          aria-expanded={promptExpanded}
          data-testid="expand-text-generation-prompt"
          className={`${themeClasses.iconButton} h-7 w-7 shrink-0`}
          onClick={() => {
            if (promptExpanded) {
              closePromptEditor();
              return;
            }
            commitPrompt();
            setPromptExpanded(true);
          }}
        >
          {promptExpanded ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div
        aria-label="文本生成需求"
        data-testid="text-generation-prompt"
        className={`flex min-h-0 overflow-hidden overscroll-contain ${promptExpanded ? "flex-1" : "h-[100px] max-h-[40dvh]"} ${running ? "opacity-60" : ""}`}
      >
        <RichPromptEditor
          value={promptDocument}
          fallbackText={prompt}
          references={TEXT_PROMPT_REFERENCES}
          placeholder="描述你想生成的文字，例如：写一段产品介绍，语气简洁自然…"
          readOnly={running}
          minHeightClassName="min-h-0"
          appearance="plain"
          onFocus={() => {
            if (running) return;
            editingPrompt.current = true;
            useHistoryStore.getState().beginTransaction();
          }}
          onBlur={commitPrompt}
          onChange={(_document, nextPrompt) =>
            useCanvasStore.getState().updateNodeData(node.id, {
              generationPrompt: nextPrompt,
            })
          }
        />
      </div>
      <div className="mt-2 flex shrink-0 items-center justify-between gap-3">
        <fieldset
          disabled={running}
          className="min-w-0 flex-1 disabled:pointer-events-none disabled:opacity-60"
        >
          <NodeModelSelector
            category="chat"
            config={config}
            selection={selection}
            onSelectModel={(model) => {
              const settings = useSettingsStore.getState();
              if (
                selection.issue === "unbound" &&
                node.data.model &&
                !settings.bindLocalModelReference(node.data.model, model)
              )
                return;
              useHistoryStore
                .getState()
                .runTracked(() =>
                  useCanvasStore.getState().updateNodeData(node.id, { model }),
                );
              settings.setDefaultModel(model);
              useTextGenerationRuntime
                .getState()
                .patch(node.id, { error: "", status: "idle" });
            }}
            stopCanvasGesture={stopGesture}
            providerAriaLabel="选择文本服务商"
            modelAriaLabel="选择文本模型和服务商"
            layout="grouped"
            appearance="ghost"
            menuPlacement="top"
            className="w-72 max-w-full"
            menuClassName="min-w-full max-w-[calc(100vw-3rem)]"
          />
        </fieldset>
        <button
          type="button"
          data-testid={`generate-text-${node.id}`}
          aria-label={running ? "停止文本生成" : "生成文本"}
          title={running ? "停止文本生成" : "生成文本"}
          disabled={!running && (!prompt.trim() || !selection.canExecute)}
          className={`${themeClasses.nodePrimaryButton} h-8 w-8 shrink-0`}
          onClick={() => {
            commitPrompt();
            if (running) textGenerationRunner.cancel(node.id);
            else void generateTextNode(node.id);
          }}
        >
          {running ? (
            <Square className="h-3.5 w-3.5 fill-current" />
          ) : runtime.status === "error" ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
      {running || issue ? (
        <p
          role="status"
          className={`mt-2 flex shrink-0 items-center gap-1.5 px-2 text-[11px] ${issue ? themeClasses.nodeWarningText : themeClasses.textMuted}`}
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {running ? "正在生成文本…" : issue}
        </p>
      ) : null}
    </section>
  );
  return promptExpanded ? (
    <GenerationPromptDialog
      onClose={closePromptEditor}
      ariaLabel="文本生成面板，放大编辑"
    >
      {panel}
    </GenerationPromptDialog>
  ) : (
    <StableNodeToolbar
      nodeId={node.id}
      position={Position.Bottom}
      offset={12}
      isVisible
      hideWhenNodeOffscreen
      hideWhenNodeDragging
      className="nodrag nopan nowheel"
    >
      {panel}
    </StableNodeToolbar>
  );
}
