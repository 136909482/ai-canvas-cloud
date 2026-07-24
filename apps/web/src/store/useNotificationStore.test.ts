import assert from "node:assert/strict";
import test from "node:test";
import { useFeedbackStore } from "./useFeedbackStore.ts";
import { useNotificationStore } from "./useNotificationStore.ts";

test.beforeEach(() => {
  useNotificationStore.setState({ items: [] });
  useFeedbackStore.setState({ toasts: [], confirmRequest: null });
});

test("notification store deduplicates repeated unread messages and tracks occurrences", () => {
  const firstId = useNotificationStore.getState().push({
    kind: "broadcast",
    title: "系统维护通知",
    message: "今晚 23:00 开始维护。",
    createdAt: "2026-07-17T12:00:00.000Z",
  });
  const repeatedId = useNotificationStore.getState().push({
    kind: "broadcast",
    title: "系统维护通知",
    message: "今晚 23:00 开始维护。",
    createdAt: "2026-07-17T12:01:00.000Z",
  });

  assert.equal(repeatedId, firstId);
  assert.equal(useNotificationStore.getState().items.length, 1);
  assert.equal(useNotificationStore.getState().items[0]?.occurrences, 2);
});

test("notification store applies a durable task event only once", () => {
  const input = {
    kind: "system" as const,
    title: "生成任务已完成",
    dedupeKey: "task-event:77777777-7777-4777-8777-777777777777",
  };
  const firstId = useNotificationStore.getState().push(input);
  useNotificationStore.getState().markRead(firstId);
  const replayedId = useNotificationStore.getState().push(input);

  assert.equal(replayedId, firstId);
  assert.equal(useNotificationStore.getState().items.length, 1);
  assert.equal(useNotificationStore.getState().items[0]?.occurrences, 1);
});

test("error and warning feedback is retained in the notification center", () => {
  useFeedbackStore.getState().notify({
    tone: "error",
    title: "图片上传失败",
    message: "对象存储暂时不可用。",
  });
  useFeedbackStore.getState().notify({
    tone: "warning",
    title: "存储空间不足",
  });
  useFeedbackStore.getState().notify({
    tone: "success",
    title: "项目已保存",
  });

  const notifications = useNotificationStore.getState().items;
  assert.deepEqual(
    notifications.map((item) => item.kind),
    ["system", "error"],
  );
  assert.equal(notifications[1]?.level, "error");

  useNotificationStore.getState().markAllRead();
  assert(notifications.every((item) => item.readAt === null));
  assert(
    useNotificationStore.getState().items.every((item) => item.readAt !== null),
  );
});

test("removes only the selected notification", () => {
  const firstId = useNotificationStore.getState().push({
    kind: "system",
    title: "任务已恢复",
  });
  const secondId = useNotificationStore.getState().push({
    kind: "broadcast",
    title: "版本更新",
  });

  useNotificationStore.getState().remove(firstId);

  assert.deepEqual(
    useNotificationStore.getState().items.map((item) => item.id),
    [secondId],
  );
});

test("clears all notifications", () => {
  useNotificationStore
    .getState()
    .push({ kind: "error", title: "资源恢复失败" });
  useNotificationStore.getState().push({ kind: "system", title: "任务已完成" });

  useNotificationStore.getState().clear();

  assert.deepEqual(useNotificationStore.getState().items, []);
});
