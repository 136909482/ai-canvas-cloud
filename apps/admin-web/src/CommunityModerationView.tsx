import { useCallback, useEffect, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminCommunityPostSummary,
  AdminCommunityReportsResponse,
  CommunityPostStatus,
} from "@ai-canvas-cloud/contracts";
import { Button, Empty, Input, Select, Space, Table, Tag } from "antd";
import { Check, Gavel, RotateCcw, X } from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader, ViewSkeleton } from "./components";
import { formatDateTime } from "./uiModel";

const STATUS_LABELS: Record<CommunityPostStatus, string> = {
  pending_review: "待审核",
  published: "已发布",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  removed: "已移除",
};
function errorMessage(error: unknown) {
  return error instanceof AdminApiError ? error.message : "社区审核请求未完成";
}

export function CommunityModerationView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "community",
    action: "community.moderate",
  });
  const [status, setStatus] = useState<CommunityPostStatus>("pending_review");
  const [posts, setPosts] = useState<AdminCommunityPostSummary[]>([]);
  const [reports, setReports] = useState<
    AdminCommunityReportsResponse["items"]
  >([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [postResponse, reportResponse] = await Promise.all([
        adminApi.communityPosts(status),
        adminApi.communityReports(),
      ]);
      setPosts(postResponse.items);
      setReports(reportResponse.items);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => {
    if (!accessLoading && access?.can) void load();
  }, [access?.can, accessLoading, load]);

  async function moderate(
    post: AdminCommunityPostSummary,
    action: "approve" | "reject" | "remove",
  ) {
    if (action !== "approve" && !reason.trim()) {
      setError("拒绝或移除必须填写审核原因");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (action === "approve") await adminApi.approveCommunityPost(post.id);
      if (action === "reject")
        await adminApi.rejectCommunityPost(post.id, reason.trim());
      if (action === "remove")
        await adminApi.removeCommunityPost(post.id, reason.trim());
      setReason("");
      setSuccess("审核状态已更新");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  async function resolve(id: string, resolution: "resolved" | "dismissed") {
    setSaving(true);
    setError(null);
    try {
      await adminApi.resolveCommunityReport(id, resolution);
      setReports((current) => current.filter((report) => report.id !== id));
      setSuccess("举报已处理");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  async function setUserVisibility(post: AdminCommunityPostSummary) {
    setSaving(true);
    setError(null);
    try {
      const response =
        post.authorProfileStatus === "hidden"
          ? await adminApi.unhideCommunityUser(post.authorUserId)
          : await adminApi.hideCommunityUser(post.authorUserId);
      setPosts((current) =>
        current.map((item) =>
          item.authorUserId === post.authorUserId
            ? { ...item, authorProfileStatus: response.profileStatus }
            : item,
        ),
      );
      setSuccess(
        response.profileStatus === "hidden" ? "用户已隐藏" : "用户已恢复公开",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  if (loading || accessLoading) return <ViewSkeleton />;
  if (!access?.can) return <AccessDenied message="当前角色不能管理社区内容" />;
  return (
    <div className="admin-page">
      <PageHeader title="社区审核" description="处理用户投稿和待处理举报" />
      <Feedback error={error} success={success} />
      <section className="table-section">
        <Space wrap className="table-toolbar">
          <Select
            value={status}
            onChange={setStatus}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="拒绝或移除原因"
          />
          <Button icon={<RotateCcw size={16} />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
        <Table
          rowKey="id"
          dataSource={posts}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无投稿" /> }}
          columns={[
            { title: "标题", dataIndex: "title" },
            {
              title: "作者",
              dataIndex: "authorPublicNickname",
              render: (value: string | null) => value ?? "-",
            },
            {
              title: "标签",
              dataIndex: "tags",
              render: (values: string[]) =>
                values.map((value) => <Tag key={value}>{value}</Tag>),
            },
            {
              title: "提交时间",
              dataIndex: "createdAt",
              render: formatDateTime,
            },
            {
              title: "操作",
              key: "actions",
              render: (_: unknown, post: AdminCommunityPostSummary) => (
                <Space>
                  {post.status === "pending_review" ? (
                    <>
                      <Button
                        type="primary"
                        size="small"
                        icon={<Check size={14} />}
                        loading={saving}
                        onClick={() => void moderate(post, "approve")}
                      >
                        通过
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<X size={14} />}
                        loading={saving}
                        onClick={() => void moderate(post, "reject")}
                      >
                        拒绝
                      </Button>
                    </>
                  ) : null}
                  {post.status === "published" ? (
                    <Button
                      size="small"
                      danger
                      icon={<Gavel size={14} />}
                      loading={saving}
                      onClick={() => void moderate(post, "remove")}
                    >
                      移除
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    loading={saving}
                    onClick={() => void setUserVisibility(post)}
                  >
                    {post.authorProfileStatus === "hidden"
                      ? "恢复用户"
                      : "隐藏用户"}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </section>
      <section className="table-section" style={{ marginTop: 20 }}>
        <PageHeader title="待处理举报" />
        <Table
          rowKey="id"
          dataSource={reports}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无待处理举报" /> }}
          columns={[
            { title: "投稿 ID", dataIndex: "postId" },
            { title: "举报原因", dataIndex: "reason" },
            {
              title: "补充说明",
              dataIndex: "detail",
              render: (value: string | null) => value ?? "-",
            },
            {
              title: "操作",
              key: "actions",
              render: (
                _: unknown,
                report: AdminCommunityReportsResponse["items"][number],
              ) => (
                <Space>
                  <Button
                    size="small"
                    loading={saving}
                    onClick={() => void resolve(report.id, "resolved")}
                  >
                    确认违规
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void resolve(report.id, "dismissed")}
                  >
                    驳回举报
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
