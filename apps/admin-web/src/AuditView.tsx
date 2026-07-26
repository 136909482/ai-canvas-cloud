import { useCan, useList } from "@refinedev/core";
import { Button, Table, Tag, Tooltip, Typography, type TableProps } from "antd";
import { RefreshCw } from "lucide-react";
import { AccessDenied, PageHeader } from "./components";
import { type AuditRecord } from "./refine";
import { formatDateTime, ROLE_LABELS } from "./uiModel";

const columns: TableProps<AuditRecord>["columns"] = [
  {
    title: "时间",
    dataIndex: "createdAt",
    width: 176,
    render: (value: string) => formatDateTime(value),
  },
  {
    title: "动作",
    dataIndex: "action",
    width: 210,
    render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
  },
  {
    title: "管理员角色",
    dataIndex: "adminRole",
    width: 120,
    responsive: ["md"],
    render: (value: AuditRecord["adminRole"]) =>
      value ? ROLE_LABELS[value] : "系统",
  },
  {
    title: "目标",
    dataIndex: "targetType",
    width: 130,
    responsive: ["lg"],
    render: (value: string | null) => value ?? "-",
  },
  {
    title: "结果",
    dataIndex: "result",
    width: 90,
    render: (value: AuditRecord["result"]) => (
      <Tag color={value === "success" ? "success" : "error"}>
        {value === "success" ? "成功" : "失败"}
      </Tag>
    ),
  },
  {
    title: "请求 ID",
    dataIndex: "requestId",
    ellipsis: true,
    responsive: ["md"],
    render: (value: string) => (
      <Tooltip title={value}>
        <Typography.Text code copyable={{ text: value }}>
          {value}
        </Typography.Text>
      </Tooltip>
    ),
  },
];

export function AuditView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "audit-events",
    action: "audit.read",
  });
  const { result, query } = useList<AuditRecord>({
    resource: "audit-events",
    pagination: { currentPage: 1, pageSize: 50 },
  });

  if (!accessLoading && access && !access.can)
    return <AccessDenied message="当前角色无权读取审计事件" />;

  return (
    <section className="admin-page">
      <PageHeader
        title="管理审计"
        description="查看管理员操作及其执行结果"
        extra={
          <Tooltip title="刷新审计事件">
            <Button
              icon={<RefreshCw size={17} />}
              loading={query.isFetching}
              onClick={() => void query.refetch()}
              aria-label="刷新审计事件"
            />
          </Tooltip>
        }
      />
      <section className="table-section">
        <Table<AuditRecord>
          rowKey="id"
          columns={columns}
          dataSource={result.data}
          loading={query.isLoading || accessLoading}
          pagination={false}
          scroll={{ x: 720 }}
          locale={{ emptyText: "暂无审计事件" }}
        />
      </section>
    </section>
  );
}
