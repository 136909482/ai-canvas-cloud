import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminCommunityPostSummary,
  AdminCommunityReportsResponse,
  CommunityPostStatus,
  CommunityReportReason,
} from "@ai-canvas-cloud/contracts";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  type TableColumnsType,
} from "antd";
import {
  Check,
  Eye,
  EyeOff,
  Flag,
  Gavel,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
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
const STATUS_COLORS: Record<CommunityPostStatus, string> = {
  pending_review: "warning",
  published: "success",
  rejected: "error",
  withdrawn: "default",
  removed: "volcano",
};
const REPORT_REASON_LABELS: Record<CommunityReportReason, string> = {
  inappropriate: "内容不当",
  copyright: "版权问题",
  privacy: "隐私泄露",
  spam: "垃圾广告",
  other: "其他",
};
const REPORT_REASON_COLORS: Record<CommunityReportReason, string> = {
  inappropriate: "volcano",
  copyright: "purple",
  privacy: "geekblue",
  spam: "gold",
  other: "default",
};
const ARCHIVE_STATUSES = ["rejected", "withdrawn", "removed"] as const;
type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];
function errorMessage(error: unknown) {
  return error instanceof AdminApiError ? error.message : "社区审核请求未完成";
}
function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function PostSection<T>({
  title,
  description,
  posts,
  columns,
  toolbar,
}: {
  title: string;
  description: string;
  posts: T[];
  columns: TableColumnsType<T>;
  toolbar?: ReactNode;
}) {
  return (
    <section className="table-section">
      <div className="table-section__heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{posts.length} 条</span>
      </div>
      {toolbar ? (
        <Space wrap className="table-toolbar community-toolbar">
          {toolbar}
        </Space>
      ) : null}
      <Table
        rowKey="id"
        dataSource={posts}
        pagination={false}
        locale={{ emptyText: <Empty description="暂无内容" /> }}
        columns={columns}
      />
    </section>
  );
}

export function CommunityModerationView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "community",
    action: "community.moderate",
  });
  const [pendingPosts, setPendingPosts] = useState<AdminCommunityPostSummary[]>(
    [],
  );
  const [publishedPosts, setPublishedPosts] = useState<
    AdminCommunityPostSummary[]
  >([]);
  const [archiveStatus, setArchiveStatus] = useState<ArchiveStatus>("rejected");
  const [archivePosts, setArchivePosts] = useState<AdminCommunityPostSummary[]>(
    [],
  );
  const [reports, setReports] = useState<
    AdminCommunityReportsResponse["items"]
  >([]);
  const [postLookup, setPostLookup] = useState(
    new Map<string, AdminCommunityPostSummary>(),
  );
  const [moderationTarget, setModerationTarget] = useState<{
    post: AdminCommunityPostSummary;
    action: "reject" | "remove";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, published, archived, reportResponse] = await Promise.all([
        adminApi.communityPosts("pending_review"),
        adminApi.communityPosts("published"),
        adminApi.communityPosts(archiveStatus),
        adminApi.communityReports(),
      ]);
      setPendingPosts(pending.items);
      setPublishedPosts(published.items);
      setArchivePosts(archived.items);
      setReports(reportResponse.items);
      setPostLookup(
        new Map(
          [...pending.items, ...published.items, ...archived.items].map(
            (post) => [post.id, post],
          ),
        ),
      );
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [archiveStatus]);
  useEffect(() => {
    if (!accessLoading && access?.can) void load();
  }, [access?.can, accessLoading, load]);

  async function approve(post: AdminCommunityPostSummary) {
    setSaving(true);
    setError(null);
    try {
      await adminApi.approveCommunityPost(post.id);
      setSuccess("投稿已通过并公开");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  function openModeration(
    post: AdminCommunityPostSummary,
    action: "reject" | "remove",
  ) {
    setReason("");
    setError(null);
    setModerationTarget({ post, action });
  }
  async function confirmModeration() {
    if (!moderationTarget) return;
    if (!reason.trim()) {
      setError("拒绝或移除必须填写审核原因");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { post, action } = moderationTarget;
      if (action === "reject")
        await adminApi.rejectCommunityPost(post.id, reason.trim());
      else await adminApi.removeCommunityPost(post.id, reason.trim());
      setReason("");
      setModerationTarget(null);
      setSuccess(action === "reject" ? "投稿已拒绝" : "投稿已移除");
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
      setSuccess(resolution === "resolved" ? "举报已标记为违规" : "举报已驳回");
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
      const apply = (items: AdminCommunityPostSummary[]) =>
        items.map((item) =>
          item.authorUserId === post.authorUserId
            ? { ...item, authorProfileStatus: response.profileStatus }
            : item,
        );
      setPendingPosts((current) => apply(current));
      setPublishedPosts((current) => apply(current));
      setArchivePosts((current) => apply(current));
      setSuccess(
        response.profileStatus === "hidden" ? "用户已隐藏" : "用户已恢复公开",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const postColumns: TableColumnsType<AdminCommunityPostSummary> = [
    {
      title: "标题",
      dataIndex: "title",
      render: (value: string) => (
        <Tooltip title={value}>
          <span className="community-post-title">{value}</span>
        </Tooltip>
      ),
    },
    {
      title: "作者",
      dataIndex: "authorPublicNickname",
      render: (value: string | null, post: AdminCommunityPostSummary) => (
        <Space size={6}>
          <span>{value ?? "-"}</span>
          {post.authorProfileStatus === "hidden" ? (
            <Tag color="default">已隐藏</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: "标签",
      dataIndex: "tags",
      render: (values: string[]) =>
        values.length ? (
          values.map((value) => <Tag key={value}>{value}</Tag>)
        ) : (
          <span className="community-muted">-</span>
        ),
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (value: CommunityPostStatus) => (
        <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag>
      ),
    },
    {
      title: "审核原因",
      dataIndex: "moderationReason",
      render: (value: string | null) =>
        value ? (
          <Tooltip title={value}>
            <span className="community-reason">{value}</span>
          </Tooltip>
        ) : (
          <span className="community-muted">-</span>
        ),
    },
    {
      title: "提交时间",
      dataIndex: "createdAt",
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_: unknown, post: AdminCommunityPostSummary) => (
        <Space wrap size={6}>
          {post.status === "pending_review" ? (
            <>
              <Popconfirm
                title="通过后投稿将对社区公开展示，确认通过？"
                okText="通过"
                cancelText="取消"
                onConfirm={() => void approve(post)}
              >
                <Button
                  type="primary"
                  size="small"
                  icon={<Check size={14} />}
                  loading={saving}
                >
                  通过
                </Button>
              </Popconfirm>
              <Button
                size="small"
                danger
                icon={<X size={14} />}
                loading={saving}
                onClick={() => void openModeration(post, "reject")}
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
              onClick={() => void openModeration(post, "remove")}
            >
              移除
            </Button>
          ) : null}
          <Popconfirm
            title={
              post.authorProfileStatus === "hidden"
                ? "恢复后该用户的社区主页将重新公开，确认恢复？"
                : "隐藏后该用户的社区主页将不可见，确认隐藏？"
            }
            okText="确认"
            cancelText="取消"
            onConfirm={() => void setUserVisibility(post)}
          >
            <Button
              size="small"
              icon={
                post.authorProfileStatus === "hidden" ? (
                  <Eye size={14} />
                ) : (
                  <EyeOff size={14} />
                )
              }
              loading={saving}
            >
              {post.authorProfileStatus === "hidden" ? "恢复用户" : "隐藏用户"}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  const reportColumns: TableColumnsType<
    AdminCommunityReportsResponse["items"][number]
  > = [
    {
      title: "相关投稿",
      dataIndex: "postId",
      render: (postId: string) => {
        const post = postLookup.get(postId);
        if (post)
          return (
            <Space size={6} wrap>
              <Tooltip title={post.title}>
                <span className="community-post-title">{post.title}</span>
              </Tooltip>
              <Tag color={STATUS_COLORS[post.status]}>
                {STATUS_LABELS[post.status]}
              </Tag>
            </Space>
          );
        return <code className="community-report-id">{shortId(postId)}</code>;
      },
    },
    {
      title: "举报原因",
      dataIndex: "reason",
      render: (reason: CommunityReportReason) => (
        <Tag color={REPORT_REASON_COLORS[reason]}>
          {REPORT_REASON_LABELS[reason]}
        </Tag>
      ),
    },
    {
      title: "补充说明",
      dataIndex: "detail",
      render: (value: string | null) =>
        value ? (
          <Tooltip title={value}>
            <span className="community-reason">{value}</span>
          </Tooltip>
        ) : (
          <span className="community-muted">-</span>
        ),
    },
    {
      title: "举报时间",
      dataIndex: "createdAt",
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (
        _: unknown,
        report: AdminCommunityReportsResponse["items"][number],
      ) => (
        <Space wrap size={6}>
          <Popconfirm
            title="确认该投稿违规？举报将标记为已处理。"
            okText="确认违规"
            cancelText="取消"
            onConfirm={() => void resolve(report.id, "resolved")}
          >
            <Button size="small" danger loading={saving}>
              确认违规
            </Button>
          </Popconfirm>
          <Popconfirm
            title="驳回该举报？驳回后将关闭此举报。"
            okText="驳回"
            cancelText="取消"
            onConfirm={() => void resolve(report.id, "dismissed")}
          >
            <Button size="small" loading={saving}>
              驳回举报
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (loading || accessLoading) return <ViewSkeleton />;
  if (!access?.can) return <AccessDenied message="当前角色不能管理社区内容" />;
  return (
    <div className="admin-page community-page">
      <PageHeader
        title="社区审核"
        description="处理用户投稿和待处理举报"
        extra={
          <Button icon={<RotateCcw size={16} />} onClick={() => void load()}>
            刷新
          </Button>
        }
      />
      <Feedback error={error} success={success} />
      <div className="community-overview" aria-label="社区审核概览">
        <div className="community-overview__card">
          <span className="community-overview__icon">
            <ShieldAlert size={17} />
          </span>
          <div>
            <strong>{pendingPosts.length}</strong>
            <span>待审核投稿</span>
          </div>
        </div>
        <div className="community-overview__card community-overview__card--green">
          <span className="community-overview__icon">
            <ShieldCheck size={17} />
          </span>
          <div>
            <strong>{publishedPosts.length}</strong>
            <span>已发布投稿</span>
          </div>
        </div>
        <div className="community-overview__card community-overview__card--red">
          <span className="community-overview__icon">
            <Flag size={17} />
          </span>
          <div>
            <strong>{reports.length}</strong>
            <span>待处理举报</span>
          </div>
        </div>
      </div>
      <PostSection
        title="待审核投稿"
        description="等待运营审核，通过后将在社区公开展示"
        posts={pendingPosts}
        columns={postColumns}
      />
      <PostSection
        title="已发布投稿"
        description="已在社区公开展示，可随时下架违规内容"
        posts={publishedPosts}
        columns={postColumns}
      />
      <PostSection
        title="历史归档"
        description="已拒绝、已撤回或被移除的投稿记录"
        posts={archivePosts}
        columns={postColumns}
        toolbar={
          <Select
            value={archiveStatus}
            onChange={setArchiveStatus}
            options={ARCHIVE_STATUSES.map((value) => ({
              value,
              label: STATUS_LABELS[value],
            }))}
          />
        }
      />
      <PostSection
        title="待处理举报"
        description="处理后可关联投稿列表处置内容"
        posts={reports}
        columns={reportColumns}
      />
      <Modal
        title={moderationTarget?.action === "reject" ? "拒绝投稿" : "移除投稿"}
        open={moderationTarget !== null}
        onCancel={() => setModerationTarget(null)}
        onOk={() => void confirmModeration()}
        okText={moderationTarget?.action === "reject" ? "确认拒绝" : "确认移除"}
        okButtonProps={{ danger: true, loading: saving }}
        cancelText="取消"
        destroyOnHidden
      >
        {moderationTarget ? (
          <div className="community-modal-intro">
            <p>
              投稿：
              <strong>{moderationTarget.post.title}</strong>
            </p>
            <p>
              作者：
              <strong>
                {moderationTarget.post.authorPublicNickname ?? "-"}
              </strong>
            </p>
            <p className="community-modal-intro__hint">
              该操作将记录审核原因，投稿作者可在社区查看。
            </p>
          </div>
        ) : null}
        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginTop: 12 }}
          />
        ) : null}
        <label className="modal-field-label" htmlFor="moderation-reason">
          审核原因（必填）
        </label>
        <Input.TextArea
          id="moderation-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          showCount
          autoSize={{ minRows: 3, maxRows: 6 }}
          placeholder="请说明拒绝或移除的具体原因"
        />
      </Modal>
    </div>
  );
}
