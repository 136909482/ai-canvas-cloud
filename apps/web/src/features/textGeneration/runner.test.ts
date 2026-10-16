import assert from "node:assert/strict";
import test from "node:test";
import {
  createTextGenerationRunner,
  type TextGenerationContext,
  type TextGenerationState,
} from "./runner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });
  return { promise, resolve, reject };
}

function fixture() {
  let context: TextGenerationContext | null = {
    scope: "account-a:workspace-a:project-a",
    content: "original",
  };
  const commits: string[] = [];
  const states: TextGenerationState[] = [];
  const runner = createTextGenerationRunner({
    readContext: () => context,
    publish: (_id, state) => states.push(state),
    commit: (_id, text) => {
      commits.push(text);
      context = { ...context!, content: text };
    },
    onError: () => "safe failure",
  });
  return {
    runner,
    states,
    commits,
    setContext: (value: TextGenerationContext | null) => {
      context = value;
    },
  };
}

test("streaming stays out of the graph and commits the final text once", async () => {
  const f = fixture();
  await f.runner.run("text-1", async (_signal, delta) => {
    delta("第一行");
    delta("第一行\n第二行");
    assert.deepEqual(f.commits, []);
    assert.equal(f.states.at(-1)?.preview, "第一行\n第二行");
    return "第一行\n第二行";
  });
  assert.deepEqual(f.commits, ["第一行\n第二行"]);
  assert.equal(f.states.at(-1)?.status, "idle");
  assert.equal(f.states.at(-1)?.preview, null);
});

test("cancel stops the request, drops partial text, and ignores a late completion", async () => {
  const f = fixture();
  const response = deferred<string>();
  let signal!: AbortSignal;
  const run = f.runner.run("text-1", async (requestSignal, delta) => {
    signal = requestSignal;
    delta("partial");
    return response.promise;
  });
  f.runner.cancel("text-1");
  assert.equal(signal.aborted, true);
  assert.equal(f.states.at(-1)?.preview, null);
  response.resolve("late");
  await run;
  assert.deepEqual(f.commits, []);
});

test("a canceled request cannot cancel a newer retry on the same node", async () => {
  const f = fixture();
  const oldResponse = deferred<string>();
  const newResponse = deferred<string>();
  const oldRun = f.runner.run("text-1", () => oldResponse.promise);
  f.runner.cancel("text-1");
  let newSignal!: AbortSignal;
  const newRun = f.runner.run("text-1", (signal) => {
    newSignal = signal;
    return newResponse.promise;
  });
  oldResponse.reject(new Error("late failure"));
  await oldRun;
  assert.equal(newSignal.aborted, false);
  assert.equal(f.states.at(-1)?.status, "running");
  newResponse.resolve("retry result");
  await newRun;
  assert.deepEqual(f.commits, ["retry result"]);
});

test("duplicate clicks do not start concurrent requests for one node", async () => {
  const f = fixture();
  const response = deferred<string>();
  let calls = 0;
  const execute = () => {
    calls += 1;
    return response.promise;
  };
  const first = f.runner.run("text-1", execute);
  await f.runner.run("text-1", execute);
  assert.equal(calls, 1);
  response.resolve("done");
  await first;
});

test("errors and empty responses preserve the original content and support retry", async () => {
  const f = fixture();
  await f.runner.run("text-1", async (_signal, delta) => {
    delta("partial");
    throw new Error("private provider details");
  });
  assert.deepEqual(f.commits, []);
  assert.deepEqual(f.states.at(-1), {
    status: "error",
    error: "safe failure",
    preview: null,
  });
  await f.runner.run("text-1", async () => "   ");
  assert.deepEqual(f.commits, []);
  await f.runner.run("text-1", async () => "retry");
  assert.deepEqual(f.commits, ["retry"]);
});

for (const [scenario, next] of [
  ["node deletion", null],
  [
    "manual edits",
    { scope: "account-a:workspace-a:project-a", content: "handwritten" },
  ],
  [
    "project switching",
    { scope: "account-a:workspace-a:project-b", content: "original" },
  ],
  [
    "account switching",
    { scope: "account-b:workspace-b:project-a", content: "original" },
  ],
] as const) {
  test(`${scenario} cancels the request and rejects late output`, async () => {
    const f = fixture();
    const response = deferred<string>();
    let signal!: AbortSignal;
    const run = f.runner.run("text-1", (value) => {
      signal = value;
      return response.promise;
    });
    f.setContext(next);
    f.runner.cancelInvalidated();
    assert.equal(signal.aborted, true);
    response.resolve("obsolete");
    await run;
    assert.deepEqual(f.commits, []);
  });
}
