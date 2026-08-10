import { useEffect, useState } from "react";
import type { SystemUpdateStatusResponse } from "@ai-canvas-cloud/contracts";
import { Button, Modal, Tag } from "antd";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  LoaderCircle,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import { adminApi } from "./api";
import { Feedback, PageHeader } from "./components";

const STATE_LABELS: Record<SystemUpdateStatusResponse["state"], string> = {
  idle: "空闲",
  queued: "等待执行",
  running: "正在更新",
  succeeded: "最近更新成功",
  failed: "最近更新失败",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "系统更新服务暂时不可用";
}

function shortDigest(digest: string | null) {
  return digest ? `${digest.slice(0, 19)}...${digest.slice(-8)}` : "-";
}

function statusColor(state: SystemUpdateStatusResponse["state"]) {
  if (state === "succeeded") return "success";
  if (state === "failed") return "error";
  if (state === "queued" || state === "running") return "processing";
  return "default";
}

export function SystemUpdateView() {
  const [status, setStatus] = useState<SystemUpdateStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const next = await adminApi.systemUpdate();
      setStatus(next);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (status?.state !== "queued" && status?.state !== "running") return;
    const timer = window.setInterval(() => void refresh(true), 4_000);
    return () => window.clearInterval(timer);
  }, [status?.state]);

  function requestUpdate() {
    Modal.confirm({
      title: "确认更新系统",
      content: "更新期间管理后台会短暂断开，服务恢复后页面将继续显示结果。",
      okText: "开始更新",
      cancelText: "取消",
      centered: true,
      async onOk() {
        setRequesting(true);
        setError(null);
        try {
          const result = await adminApi.requestSystemUpdate();
          setStatus((current) =>
            current
              ? { ...current, state: result.state, requestId: result.requestId }
              : current,
          );
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        } finally {
          setRequesting(false);
        }
      },
    });
  }

  const busy = status?.state === "queued" || status?.state === "running";
  const stateIcon = busy ? (
    <LoaderCircle className="system-update-spin" size={20} />
  ) : status?.state === "failed" ? (
    <CircleAlert size={20} />
  ) : (
    <CheckCircle2 size={20} />
  );

  return (
    <main className="admin-page system-update-page">
      <PageHeader
        title="系统更新"
        description="单机部署版本与发布状态"
        extra={
          <Button
            icon={<RefreshCw size={16} />}
            loading={loading}
            onClick={() => void refresh()}
          >
            检查更新
          </Button>
        }
      />
      <Feedback error={error} />

      <section className="surface-section system-update-overview">
        <header className="system-update-heading">
          <span className="section-heading__icon">
            <ServerCog size={18} />
          </span>
          <div>
            <strong>发布状态</strong>
            <span>
              {status?.checkedAt
                ? new Date(status.checkedAt).toLocaleString()
                : "-"}
            </span>
          </div>
          <Tag color={statusColor(status?.state ?? "idle")}>
            {STATE_LABELS[status?.state ?? "idle"]}
          </Tag>
        </header>

        <div className="system-update-digests">
          <div>
            <span>当前镜像</span>
            <strong title={status?.currentDigest ?? undefined}>
              {shortDigest(status?.currentDigest ?? null)}
            </strong>
          </div>
          <div>
            <span>最新镜像</span>
            <strong title={status?.latestDigest ?? undefined}>
              {shortDigest(status?.latestDigest ?? null)}
            </strong>
          </div>
        </div>

        <div
          className={`system-update-state system-update-state--${status?.state ?? "idle"}`}
        >
          <span>{stateIcon}</span>
          <div>
            <strong>
              {!status?.enabled
                ? "当前环境未启用在线更新"
                : busy
                  ? "正在执行发布流程"
                  : status.updateAvailable
                    ? "发现新版本"
                    : status.state === "failed"
                      ? "更新未完成"
                      : "已是最新版本"}
            </strong>
            <span>
              {busy
                ? "拉取、备份、迁移与健康检查正在进行"
                : status?.finishedAt
                  ? new Date(status.finishedAt).toLocaleString()
                  : ""}
            </span>
          </div>
        </div>

        <footer className="system-update-actions">
          <Button
            type="primary"
            icon={<Download size={16} />}
            disabled={!status?.enabled || !status.updateAvailable || busy}
            loading={requesting}
            onClick={requestUpdate}
          >
            拉取并更新
          </Button>
        </footer>
      </section>
    </main>
  );
}
