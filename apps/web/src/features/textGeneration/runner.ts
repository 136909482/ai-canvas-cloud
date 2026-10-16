export interface TextGenerationContext {
  scope: string;
  content: string;
}

export interface TextGenerationState {
  status: "idle" | "running" | "error";
  preview: string | null;
  error: string;
}

export const EMPTY_TEXT_GENERATION_STATE: TextGenerationState = {
  status: "idle",
  preview: null,
  error: "",
};

interface ActiveTextGeneration {
  controller: AbortController;
  context: TextGenerationContext;
}

/** Keep streaming drafts outside the project graph and reject stale completions. */
export function createTextGenerationRunner(dependencies: {
  readContext: (nodeId: string) => TextGenerationContext | null;
  publish: (nodeId: string, state: TextGenerationState) => void;
  commit: (nodeId: string, text: string) => void;
  onError: (error: unknown) => string;
}) {
  const runs = new Map<string, ActiveTextGeneration>();
  const isValid = (nodeId: string, run: ActiveTextGeneration) => {
    const current = dependencies.readContext(nodeId);
    return (
      runs.get(nodeId) === run &&
      current?.scope === run.context.scope &&
      current.content === run.context.content
    );
  };
  const cancel = (nodeId: string) => {
    const run = runs.get(nodeId);
    if (!run) return;
    runs.delete(nodeId);
    run.controller.abort();
    dependencies.publish(nodeId, { ...EMPTY_TEXT_GENERATION_STATE });
  };
  return {
    cancel,
    cancelAll() {
      for (const nodeId of runs.keys()) cancel(nodeId);
    },
    cancelInvalidated() {
      for (const [nodeId, run] of runs) {
        if (!isValid(nodeId, run)) cancel(nodeId);
      }
    },
    async run(
      nodeId: string,
      execute: (
        signal: AbortSignal,
        onDelta: (text: string) => void,
      ) => Promise<string>,
    ) {
      if (runs.has(nodeId)) return;
      const context = dependencies.readContext(nodeId);
      if (!context) return;
      const run = { controller: new AbortController(), context };
      runs.set(nodeId, run);
      dependencies.publish(nodeId, {
        status: "running",
        preview: "",
        error: "",
      });
      try {
        const text = await execute(run.controller.signal, (preview) => {
          if (isValid(nodeId, run))
            dependencies.publish(nodeId, {
              status: "running",
              preview,
              error: "",
            });
        });
        if (!isValid(nodeId, run)) {
          if (runs.get(nodeId) === run) cancel(nodeId);
          return;
        }
        if (!text.trim()) throw new Error("模型未返回可用内容");
        // Remove the guard before committing: this commit intentionally changes content.
        runs.delete(nodeId);
        dependencies.publish(nodeId, { ...EMPTY_TEXT_GENERATION_STATE });
        dependencies.commit(nodeId, text);
      } catch (error) {
        if (!isValid(nodeId, run)) {
          if (runs.get(nodeId) === run) cancel(nodeId);
          return;
        }
        runs.delete(nodeId);
        dependencies.publish(nodeId, {
          status: "error",
          preview: null,
          error: dependencies.onError(error),
        });
      }
    },
  };
}
