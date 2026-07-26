import type { ReactNode } from "react";
import type { AdminManagedUserStatus } from "@ai-canvas-cloud/contracts";
import { Alert, Button, Empty, Skeleton, Tag } from "antd";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { USER_STATUS_LABELS } from "./uiModel";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`admin-brand${compact ? " admin-brand--compact" : ""}`}>
      <img src="/brand/ai-canvas-mark.png" alt="" />
      <div>
        <strong>AI Canvas</strong>
        <span>管理控制台</span>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  extra,
  onBack,
}: {
  title: string;
  description?: string;
  extra?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <header className="page-header">
      <div className="page-header__identity">
        {onBack ? (
          <Button
            type="text"
            icon={<ArrowLeft size={18} />}
            onClick={onBack}
            aria-label="返回"
          />
        ) : null}
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {extra ? <div className="page-header__extra">{extra}</div> : null}
    </header>
  );
}

export function Feedback({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  if (error)
    return (
      <Alert
        className="page-feedback"
        type="error"
        showIcon
        message={error}
        role="alert"
      />
    );
  if (success)
    return (
      <Alert
        className="page-feedback"
        type="success"
        showIcon
        message={success}
        role="status"
      />
    );
  return null;
}

export function AccessDenied({ message }: { message: string }) {
  return (
    <div className="state-panel">
      <Empty image={<TriangleAlert size={32} />} description={message} />
    </div>
  );
}

export function ViewSkeleton() {
  return (
    <div className="admin-page view-skeleton" aria-label="页面加载中">
      <Skeleton active title paragraph={{ rows: 7 }} />
    </div>
  );
}

export function UserStatusTag({ status }: { status: AdminManagedUserStatus }) {
  const color =
    status === "active"
      ? "success"
      : status === "disabled"
        ? "error"
        : "default";
  return <Tag color={color}>{USER_STATUS_LABELS[status]}</Tag>;
}

export function VerificationTag({ verified }: { verified: boolean }) {
  return (
    <Tag color={verified ? "success" : "warning"}>
      {verified ? "已验证" : "未验证"}
    </Tag>
  );
}
