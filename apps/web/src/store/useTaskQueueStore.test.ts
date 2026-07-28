import { recoverTasksAfterSnapshotLoad } from "@/features/generateQueue/taskQueueSnapshot";
import { useTaskQueueStore } from "./useTaskQueueStore.ts";
import type { GenerateTask } from "@/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createTask(overrides: Partial<GenerateTask>): GenerateTask {
  return {
    id: "task-1",
    displayId: "display-1",
    projectId: "project-1",
    kind: "image",
    sourceNodeId: "gen-1",
    previewNodeId: "preview-1",
    model: "model-1",
    prompt: "prompt",
    negativePrompt: "",
    ratio: "1:1",
    resolution: "1K",
    operationType: "text-to-image",
    sourceImageNodeId: null,
    maskImageUrl: null,
    apiProfileId: null,
    apiProfileName: null,
    provider: "openai",
    referenceImageUrls: [],
    inputFidelity: null,
    quality: null,
    googleSearch: false,
    googleImageSearch: false,
    videoMode: null,
    videoDuration: null,
    resultImageAsset: null,
    resultVideoAsset: null,
    status: "queued",
    errorMsg: "",
    remoteTaskId: null,
    remoteStatus: null,
    createdAt: 100,
    startedAt: 0,
    finishedAt: null,
    ...overrides,
    referenceImages: overrides.referenceImages ?? [],
  };
}

function runTaskQueueRecoveryTests() {
  const recoveredTasks = recoverTasksAfterSnapshotLoad([
    createTask({
      id: "queued",
      status: "queued",
      errorMsg: "stale",
      remoteTaskId: "old-remote",
      remoteStatus: "IN_PROGRESS",
      startedAt: 200,
    }),
    createTask({ id: "running-local", status: "running", startedAt: 300 }),
    createTask({
      id: "running-remote",
      status: "running",
      remoteTaskId: "remote-1",
      remoteStatus: "SUCCESS",
      telemetryAttemptId: "019f97c9-f0e2-7411-aa9b-6532e82af3bc",
      telemetryStartedAt: 350,
      startedAt: 400,
    }),
    createTask({
      id: "video-persist-error",
      kind: "video",
      status: "running",
      phase: "persisting",
      remoteTaskId: "video-remote-1",
      startedAt: 450,
    }),
    createTask({
      id: "done",
      status: "done",
      finishedAt: 500,
      resultImageAsset: {
        relativePath: "images/a.png",
        mimeType: "image/png",
        fileName: "a.png",
      },
    }),
    createTask({
      id: "error",
      status: "error",
      errorMsg: "失败",
      finishedAt: 600,
    }),
  ]);

  const queuedTask = recoveredTasks.find((task) => task.id === "queued");
  assert(
    queuedTask?.status === "queued",
    "queued tasks should remain queued after snapshot load",
  );
  assert(
    queuedTask.remoteTaskId === null,
    "queued tasks should not keep stale remote ids",
  );
  assert(queuedTask.errorMsg === "", "queued tasks should clear stale errors");
  assert(
    queuedTask.startedAt === 0,
    "queued tasks should clear stale startedAt",
  );

  const localRunningTask = recoveredTasks.find(
    (task) => task.id === "running-local",
  );
  assert(
    localRunningTask?.status === "error",
    "local running tasks should be interrupted after refresh",
  );
  assert(
    localRunningTask.errorMsg.includes("同步任务已中断"),
    "interrupted local tasks should require an explicit retry",
  );

  const remoteRunningTask = recoveredTasks.find(
    (task) => task.id === "running-remote",
  );
  assert(
    remoteRunningTask?.status === "queued",
    "remote running tasks should re-enter the scheduler before polling",
  );
  assert(
    remoteRunningTask.remoteTaskId === "remote-1",
    "remote running tasks should preserve remote task id",
  );
  assert(
    remoteRunningTask.remoteStatus === "IN_PROGRESS",
    "remote running tasks should resume polling from an in-progress state",
  );
  assert(
    remoteRunningTask.phase === "polling",
    "remote running tasks should preserve the polling phase",
  );
  assert(
    remoteRunningTask.telemetryAttemptId ===
      "019f97c9-f0e2-7411-aa9b-6532e82af3bc",
    "remote running tasks should preserve their telemetry attempt id",
  );
  assert(
    remoteRunningTask.telemetryStartedAt === 350,
    "remote running tasks should preserve their telemetry start time",
  );

  const videoPersistTask = recoveredTasks.find(
    (task) => task.id === "video-persist-error",
  );
  assert(
    videoPersistTask?.status === "queued" &&
      videoPersistTask.phase === "polling",
    "video upload recovery should re-query its remote result instead of using the image Blob path",
  );

  const doneTask = recoveredTasks.find((task) => task.id === "done");
  assert(doneTask?.status === "done", "done tasks should remain done");
  assert(
    doneTask.resultImageAsset?.relativePath === "images/a.png",
    "done tasks should preserve result assets",
  );

  const errorTask = recoveredTasks.find((task) => task.id === "error");
  assert(errorTask?.status === "error", "failed tasks should remain failed");
  assert(
    errorTask.errorMsg === "失败",
    "failed tasks should preserve error messages",
  );

  const reassignedTask = recoverTasksAfterSnapshotLoad(
    [createTask({ projectId: "source-project" })],
    "opened-project",
  )[0];
  assert(
    reassignedTask.projectId === "opened-project",
    "loaded tasks should belong to the project that contains the snapshot",
  );

  const legacyTask = createTask({
    operationType: "image-to-image",
    referenceImageUrls: ["https://legacy/reference.png"],
  });
  (legacyTask as unknown as Record<string, unknown>).referenceImages =
    undefined;
  const migratedLegacyTask = recoverTasksAfterSnapshotLoad([legacyTask])[0];
  assert(
    migratedLegacyTask.referenceImages[0]?.imageUrl ===
      "https://legacy/reference.png",
    "legacy URL-only task snapshots should migrate to structured image inputs",
  );
}

runTaskQueueRecoveryTests();

function runTaskQueueRetryTelemetryTests() {
  const store = useTaskQueueStore.getState();
  store.resetToEmpty();
  const taskId = store.createTask({
    sourceNodeId: "gen-retry",
    model: "model-1",
    prompt: "prompt",
    telemetryAttemptId: "019f97c9-f0e2-7411-aa9b-6532e82af3bc",
    telemetryStartedAt: 100,
  });

  useTaskQueueStore.getState().markTaskQueued(taskId);
  const retriedTask = useTaskQueueStore
    .getState()
    .tasks.find((task) => task.id === taskId);

  assert(retriedTask, "retried task should still exist");
  assert(
    retriedTask.telemetryAttemptId === null,
    "manual retry should clear the previous telemetry attempt id",
  );
  assert(
    retriedTask.telemetryStartedAt === null,
    "manual retry should clear the previous telemetry start time",
  );

  useTaskQueueStore.getState().resetToEmpty();
}

runTaskQueueRetryTelemetryTests();

function runTaskImageSourceSnapshotTests() {
  const store = useTaskQueueStore.getState();
  store.resetToEmpty();
  store.createTask({
    sourceNodeId: "gen-image-source",
    model: "model-1",
    prompt: "prompt",
    operationType: "image-to-image",
    referenceImages: [
      {
        sourceNodeId: "image-1",
        imageUrl: "https://storage.example/signed?expires=soon",
        assetRelativePath: "cloud-assets/11111111-1111-4111-8111-111111111111",
      },
    ],
  });

  const snapshot = useTaskQueueStore.getState().getSnapshot();
  const persistedSource = snapshot.tasks[0]?.referenceImages[0];
  assert(
    persistedSource?.assetRelativePath ===
      "cloud-assets/11111111-1111-4111-8111-111111111111",
    "task snapshots should preserve stable asset locators",
  );
  assert(
    persistedSource.imageUrl === "",
    "task snapshots should not persist expiring signed asset URLs",
  );

  store.replaceSnapshot(snapshot, "project-1");
  const restoredSource =
    useTaskQueueStore.getState().tasks[0]?.referenceImages[0];
  assert(
    restoredSource?.assetRelativePath === persistedSource.assetRelativePath,
    "restored tasks should retain stable asset locators without a signed URL",
  );
  store.resetToEmpty();
}

runTaskImageSourceSnapshotTests();

function runAtomicClaimTests() {
  const store = useTaskQueueStore.getState();
  store.resetToEmpty();
  const taskId = store.createTask({
    sourceNodeId: "gen-claim",
    model: "model-1",
    prompt: "prompt",
  });

  const firstClaim = useTaskQueueStore.getState().claimTask(taskId);
  const duplicateClaim = useTaskQueueStore.getState().claimTask(taskId);
  assert(
    firstClaim?.status === "running",
    "the first claim should start the task",
  );
  assert(duplicateClaim === null, "a claimed task must not be claimed twice");

  useTaskQueueStore.getState().resetToEmpty();
  const remoteTaskId = useTaskQueueStore.getState().createTask({
    sourceNodeId: "gen-polling",
    model: "model-1",
    prompt: "prompt",
  });
  useTaskQueueStore.getState().attachRemoteTask(remoteTaskId, "remote-1");
  useTaskQueueStore.getState().queueRemoteTask(remoteTaskId);
  const pollingClaim = useTaskQueueStore.getState().claimTask(remoteTaskId);
  assert(
    pollingClaim?.phase === "polling",
    "claiming a remote task must not turn polling into a new POST request",
  );
  assert(
    pollingClaim.remoteTaskId === "remote-1",
    "claiming a remote task should preserve the upstream task id",
  );

  useTaskQueueStore.getState().resetToEmpty();
}

runAtomicClaimTests();

function runProviderBindingTests() {
  const store = useTaskQueueStore.getState();
  store.resetToEmpty();
  const taskId = store.createTask({
    sourceNodeId: "gen-binding",
    model: "model-1",
    prompt: "prompt",
  });
  store.bindTaskProvider(taskId, {
    apiProfileId: "provider-1",
    apiProfileName: "Provider",
    provider: "openai",
    executionMode: "polling",
    adapterId: "openai-compatible-task-polling",
    providerBindingFingerprint: "fingerprint-1",
  });

  const boundTask = useTaskQueueStore
    .getState()
    .tasks.find((task) => task.id === taskId);
  assert(
    boundTask?.apiProfileId === "provider-1",
    "provider id should be bound",
  );
  assert(
    boundTask?.providerBindingFingerprint === "fingerprint-1",
    "provider fingerprint should be persisted before execution",
  );

  useTaskQueueStore.getState().resetToEmpty();
}

runProviderBindingTests();

function runIndependentTaskIdentityTests() {
  const store = useTaskQueueStore.getState();
  store.resetToEmpty();
  const taskIds = Array.from({ length: 8 }, () =>
    useTaskQueueStore.getState().createTask({
      sourceNodeId: "shared-source",
      model: "model-1",
      prompt: "same prompt",
    }),
  );

  assert(
    new Set(taskIds).size === 8,
    "repeated clicks on one source node should create independent task ids",
  );
  assert(
    useTaskQueueStore.getState().tasks.length === 8,
    "repeated clicks should preserve all independent tasks",
  );

  useTaskQueueStore.getState().resetToEmpty();
}

runIndependentTaskIdentityTests();
