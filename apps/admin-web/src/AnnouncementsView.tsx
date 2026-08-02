import { useEffect, useMemo, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminAnnouncement,
  AnnouncementCategory,
  SaveAnnouncementDraftRequest,
} from "@ai-canvas-cloud/contracts";
import {
  Button,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
} from "antd";
import {
  Archive,
  BellRing,
  FilePenLine,
  Plus,
  Radio,
  Save,
} from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader, ViewSkeleton } from "./components";
import { formatDateTime } from "./uiModel";

const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  notice: "平台通知",
  product_update: "产品更新",
  maintenance: "维护提醒",
};

const STATUS_LABELS: Record<AdminAnnouncement["status"], string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已下线",
};

function errorMessage(error: unknown) {
  return error instanceof AdminApiError ? error.message : "站内通知请求未完成";
}

const EMPTY_DRAFT: SaveAnnouncementDraftRequest = {
  category: "notice",
  title: "",
  content: "",
};

function sortAnnouncements(items: AdminAnnouncement[]) {
  return [...items].sort(
    (left, right) =>
      new Date(right.publishedAt ?? right.createdAt).getTime() -
      new Date(left.publishedAt ?? left.createdAt).getTime(),
  );
}

export function AnnouncementsView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "announcements",
    action: "announcement.write",
  });
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaveAnnouncementDraftRequest>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const orderedItems = useMemo(() => sortAnnouncements(items), [items]);

  useEffect(() => {
    if (accessLoading || !access?.can) {
      setLoading(accessLoading);
      return;
    }
    let active = true;
    adminApi
      .announcements()
      .then((response) => {
        if (active) setItems(response.items);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [access?.can, accessLoading]);

  function upsert(item: AdminAnnouncement) {
    setItems((current) => [
      item,
      ...current.filter((entry) => entry.id !== item.id),
    ]);
  }

  function beginNew() {
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setSuccess(null);
  }

  function select(item: AdminAnnouncement) {
    setSelectedId(item.id);
    setDraft({
      category: item.category,
      title: item.title,
      content: item.content,
    });
    setError(null);
    setSuccess(null);
  }

  async function saveDraft() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = selectedId
        ? await adminApi.updateAnnouncementDraft(selectedId, draft)
        : await adminApi.createAnnouncementDraft(draft);
      upsert(response.announcement);
      setSelectedId(response.announcement.id);
      setSuccess("草稿已保存，用户暂时不可见");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await adminApi.publishAnnouncement(selectedId);
      upsert(response.announcement);
      setSuccess("通知已发布到全部登录用户的时间线");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await adminApi.archiveAnnouncement(selectedId);
      upsert(response.announcement);
      setSuccess("通知已从用户时间线下线");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (loading || accessLoading) return <ViewSkeleton />;
  if (!access?.can) return <AccessDenied message="当前角色不能管理站内通知" />;

  const editable = !selected || selected.status === "draft";

  return (
    <div className="admin-page announcements-page">
      <PageHeader
        title="站内通知"
        description="编辑平台公告，并按发布时间沉淀为用户可回看的时间线"
        extra={
          <Button icon={<Plus size={16} />} onClick={beginNew}>
            新建通知
          </Button>
        }
      />
      <Feedback error={error} success={success} />

      <div className="announcement-workbench">
        <section className="announcement-editor" aria-label="通知编辑器">
          <div className="announcement-section-heading">
            <span className="announcement-section-icon">
              <FilePenLine size={17} />
            </span>
            <div>
              <strong>
                {selected ? STATUS_LABELS[selected.status] : "新通知"}
              </strong>
              <span>
                {editable ? "保存为草稿后再确认发布" : "已发布内容不可修改"}
              </span>
            </div>
          </div>
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="通知类型">
              <Select
                value={draft.category}
                disabled={!editable}
                onChange={(category) =>
                  setDraft((current) => ({ ...current, category }))
                }
                options={Object.entries(CATEGORY_LABELS).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </Form.Item>
            <Form.Item label="标题">
              <Input
                value={draft.title}
                disabled={!editable}
                maxLength={120}
                showCount
                placeholder="例如：图像模型列表更新"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </Form.Item>
            <Form.Item label="正文">
              <Input.TextArea
                value={draft.content}
                disabled={!editable}
                maxLength={4000}
                showCount
                autoSize={{ minRows: 8, maxRows: 16 }}
                placeholder="说明变更内容、影响范围和用户需要关注的事项"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
              />
            </Form.Item>
          </Form>
          <div className="announcement-editor-actions">
            {editable ? (
              <Button
                type="primary"
                icon={<Save size={16} />}
                loading={saving}
                onClick={() => void saveDraft()}
              >
                保存草稿
              </Button>
            ) : null}
            {selected?.status === "draft" ? (
              <Popconfirm
                title="发布后将立即对全部登录用户可见，确认发布？"
                onConfirm={() => void publish()}
              >
                <Button icon={<Radio size={16} />} loading={saving}>
                  立即发布
                </Button>
              </Popconfirm>
            ) : null}
            {selected?.status === "published" ? (
              <Popconfirm
                title="下线后用户时间线将不再显示，确认下线？"
                onConfirm={() => void archive()}
              >
                <Button danger icon={<Archive size={16} />} loading={saving}>
                  下线通知
                </Button>
              </Popconfirm>
            ) : null}
          </div>
        </section>

        <section className="announcement-history" aria-label="通知历史">
          <div className="announcement-section-heading">
            <span className="announcement-section-icon">
              <BellRing size={17} />
            </span>
            <div>
              <strong>发布记录</strong>
              <span>{items.length} 条通知与草稿</span>
            </div>
          </div>
          {orderedItems.length ? (
            <div className="admin-announcement-timeline">
              {orderedItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`admin-announcement-entry${selectedId === item.id ? " is-selected" : ""}`}
                  onClick={() => select(item)}
                >
                  <span
                    className={`admin-announcement-dot is-${item.category}`}
                  />
                  <span className="admin-announcement-entry__content">
                    <span className="admin-announcement-entry__topline">
                      <strong>{item.title}</strong>
                      <Space size={4}>
                        <Tag>{CATEGORY_LABELS[item.category]}</Tag>
                        <Tag
                          color={
                            item.status === "published"
                              ? "success"
                              : item.status === "draft"
                                ? "warning"
                                : "default"
                          }
                        >
                          {STATUS_LABELS[item.status]}
                        </Tag>
                      </Space>
                    </span>
                    <span className="admin-announcement-entry__body">
                      {item.content}
                    </span>
                    <span className="admin-announcement-entry__time">
                      {item.publishedAt
                        ? `发布于 ${formatDateTime(item.publishedAt)}`
                        : `更新于 ${formatDateTime(item.updatedAt)}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有站内通知"
            />
          )}
        </section>
      </div>
    </div>
  );
}
