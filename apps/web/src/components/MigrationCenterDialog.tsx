import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Download,
  FileArchive,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { requestCloudJson } from "@/api/cloudApiClient";
import { CloudApiError } from "@/api/cloudApiClient";
import {
  completeMigrationAssetPart,
  completeMigrationAssetUpload,
  commitMigrationImport,
  downloadMigrationExport,
  getMigrationExport,
  getMigrationImport,
  parseMigrationPackage,
  prepareMigrationAssetUpload,
  prepareMigrationExport,
  prepareMigrationImport,
  toOwnedArrayBuffer,
  uploadToSignedUrl,
} from "@/api/migrations";
import type { ProjectGraphResponse } from "@ai-canvas-cloud/contracts";
import { useProjectStore } from "@/store/useProjectStore";
import { useMigrationStore } from "@/store/useMigrationStore";
import { useNotificationStore } from "@/store/useNotificationStore";
import { themeClasses } from "@/styles/themeClasses";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    prepared: "已预检",
    uploading: "上传中",
    validating: "校验中",
    ready: "等待提交",
    committing: "提交中",
    completed: "已完成",
    generating: "生成中",
    failed: "失败",
    canceled: "已取消",
    expired: "已过期",
  };
  return labels[status] ?? status;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--control-bg)]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-teal-400 via-sky-400 to-violet-400 transition-[width] duration-300"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function MigrationCenterDialog({ onClose }: { onClose: () => void }) {
  const importSummary = useMigrationStore((state) => state.importSummary);
  const importPackage = useMigrationStore((state) => state.importPackage);
  const importBusy = useMigrationStore((state) => state.importBusy);
  const exportSummary = useMigrationStore((state) => state.exportSummary);
  const exportBusy = useMigrationStore((state) => state.exportBusy);
  const setImport = useMigrationStore((state) => state.setImport);
  const setImportBusy = useMigrationStore((state) => state.setImportBusy);
  const setExport = useMigrationStore((state) => state.setExport);
  const cancelImport = useMigrationStore((state) => state.cancelImport);
  const cancelExport = useMigrationStore((state) => state.cancelExport);
  const retryExport = useMigrationStore((state) => state.retryExport);
  const clearImport = useMigrationStore((state) => state.clearImport);
  const clearExport = useMigrationStore((state) => state.clearExport);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) => state.getActiveProject());
  const notify = useNotificationStore((state) => state.push);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"import" | "export">("import");
  const [isPicking, setIsPicking] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [strategy, setStrategy] = useState<"copy" | "replace">("copy");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentImport = useMigrationStore.getState().importSummary;
      const currentExport = useMigrationStore.getState().exportSummary;
      if (
        currentImport &&
        ["prepared", "uploading", "validating", "ready", "committing"].includes(
          currentImport.status,
        )
      ) {
        void getMigrationImport(currentImport.id)
          .then((response) => setImport(response.import))
          .catch(() => undefined);
      }
      if (
        currentExport &&
        ["prepared", "generating"].includes(currentExport.status)
      ) {
        void getMigrationExport(currentExport.projectId, currentExport.id)
          .then((response) =>
            setExport(currentExport.projectId, {
              ...response.export,
              projectId: currentExport.projectId,
            }),
          )
          .catch(() => undefined);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [setExport, setImport]);

  const handlePackage = async (file: File) => {
    setIsPicking(true);
    setError(null);
    setVersionConflict(false);
    setUploadProgress(0);
    try {
      const parsed = await parseMigrationPackage(file);
      const resumable =
        importSummary &&
        importSummary.packageId === parsed.manifest.packageId &&
        ["prepared", "uploading", "validating", "ready"].includes(
          importSummary.status,
        );
      const summary = resumable
        ? importSummary
        : (
            await prepareMigrationImport({
              idempotencyKey: crypto.randomUUID(),
              manifest: parsed.manifest,
              projectRecord: parsed.projectRecord,
              graph: parsed.graph,
              assetManifest: parsed.assetManifest,
              checkpoint: parsed.checkpoint,
              archiveEntries: parsed.archiveEntries,
            })
          ).import;
      setImport(summary, parsed);
      setStrategy(
        summary.allowedStrategies.includes("copy") ? "copy" : "replace",
      );
      if (summary.uploads.length > 0) {
        setImportBusy(true);
        let completed = 0;
        for (const asset of parsed.assetManifest.assets) {
          const body = parsed.files.get(asset.filePath);
          if (!body) throw new Error(`目录包缺少资产：${asset.filePath}`);
          const upload = await prepareMigrationAssetUpload(
            summary.id,
            asset.logicalAssetId,
          );
          const target = upload.upload;
          if (target.status === "completed") {
            completed += 1;
            setUploadProgress(
              (completed / parsed.assetManifest.assets.length) * 100,
            );
            continue;
          }
          if (target.directUpload) {
            await uploadToSignedUrl(
              target.directUpload.url,
              new Blob([toOwnedArrayBuffer(body)], { type: asset.mimeType }),
              target.directUpload.headers,
              (value) =>
                setUploadProgress(
                  ((completed + value) / parsed.assetManifest.assets.length) *
                    100,
                ),
            );
            await completeMigrationAssetUpload(
              summary.id,
              asset.logicalAssetId,
            );
          } else {
            const parts: Record<string, { etag: string; byteSize: number }> =
              {};
            for (const part of target.parts) {
              const start = (part.partNumber - 1) * target.partSize;
              const chunk = new Blob(
                [toOwnedArrayBuffer(body.slice(start, start + part.byteSize))],
                { type: asset.mimeType },
              );
              const uploaded = await uploadToSignedUrl(
                part.url,
                chunk,
                part.headers,
                (value) =>
                  setUploadProgress(
                    ((completed +
                      (part.partNumber - 1 + value / target.partCount)) /
                      parsed.assetManifest.assets.length) *
                      100,
                  ),
              );
              const etag = uploaded.etag;
              if (!etag)
                throw new Error(
                  "对象存储未返回分片 ETag，请检查跨域响应头配置",
                );
              parts[String(part.partNumber)] = {
                etag,
                byteSize: part.byteSize,
              };
              await completeMigrationAssetPart(
                summary.id,
                asset.logicalAssetId,
                part.partNumber,
                { etag, byteSize: part.byteSize },
              );
            }
            await completeMigrationAssetUpload(
              summary.id,
              asset.logicalAssetId,
              parts,
            );
          }
          completed += 1;
          setUploadProgress(
            (completed / parsed.assetManifest.assets.length) * 100,
          );
        }
        setImportBusy(false);
        const latest = await getMigrationImport(summary.id);
        setImport(latest.import, parsed);
      }
      notify({
        kind: "system",
        title: "目录包预检完成",
        message: `${summary.project.name} · ${summary.estimates.assetCount} 个资产`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setImportBusy(false);
    } finally {
      setIsPicking(false);
    }
  };

  const handleCommit = async (requestedStrategy = strategy) => {
    if (
      !importSummary ||
      !importSummary.allowedStrategies.includes(requestedStrategy) ||
      (requestedStrategy === "replace" && !replaceConfirmed)
    )
      return;
    setImportBusy(true);
    setError(null);
    setVersionConflict(false);
    try {
      const expected =
        requestedStrategy === "replace"
          ? importSummary.conflict.targetProject
          : null;
      await commitMigrationImport(importSummary.id, {
        idempotencyKey: crypto.randomUUID(),
        strategy: requestedStrategy,
        expectedVersion: expected?.expectedVersion,
        expectedSequence: expected?.expectedSequence,
        confirmReplace: requestedStrategy === "replace" && replaceConfirmed,
      });
      const latest = await getMigrationImport(importSummary.id);
      setImport(latest.import, importPackage);
      notify({
        kind: "system",
        title: "目录包已导入",
        message: latest.import.project.name,
      });
      await useProjectStore.getState().reloadFromWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setVersionConflict(
        cause instanceof CloudApiError &&
          cause.code === "PROJECT_VERSION_CONFLICT",
      );
      const latest = await getMigrationImport(importSummary.id).catch(
        () => null,
      );
      if (latest) setImport(latest.import, importPackage);
    } finally {
      setImportBusy(false);
    }
  };

  const handleExport = async () => {
    if (!activeProjectId) return;
    setError(null);
    try {
      const graph = await requestCloudJson<ProjectGraphResponse>(
        `/projects/${encodeURIComponent(activeProjectId)}/graph`,
      );
      const response = await prepareMigrationExport(activeProjectId, {
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: graph.version,
        expectedSequence: graph.sequence,
      });
      setExport(activeProjectId, {
        ...response.export,
        projectId: activeProjectId,
      });
      notify({
        kind: "system",
        title: "导出任务已创建",
        message: `${activeProject?.name ?? "项目"} · 版本 ${graph.version} / 序列 ${graph.sequence}`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleDownload = async () => {
    if (!exportSummary) return;
    try {
      const result = await downloadMigrationExport(
        exportSummary.projectId,
        exportSummary.id,
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importPercent = importSummary
    ? importSummary.estimates.fileCount
      ? Math.round(
          (importSummary.progress.completedFileCount /
            importSummary.estimates.fileCount) *
            100,
        )
      : 0
    : 0;
  const exportPercent = exportSummary
    ? exportSummary.progress.fileCount
      ? Math.round(
          (exportSummary.progress.completedFileCount /
            exportSummary.progress.fileCount) *
            100,
        )
      : 0
    : 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 px-4 py-14 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="migration-center-title"
        className={`flex max-h-[min(44rem,calc(100vh-7rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl ${themeClasses.strongPanel}`}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2
              id="migration-center-title"
              className={`text-base font-semibold ${themeClasses.textPrimary}`}
            >
              迁移中心
            </h2>
            <p className={`mt-1 text-[11px] ${themeClasses.textMuted}`}>
              目录包在云端预检、上传并提交；状态可在刷新后恢复
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭迁移中心"
            className={`${themeClasses.iconButton} h-8 w-8`}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid grid-cols-2 gap-1 border-b border-[var(--border-subtle)] bg-[var(--control-bg)] p-1.5">
          <button
            type="button"
            onClick={() => setTab("import")}
            className={`flex h-9 items-center justify-center gap-2 rounded-md text-xs font-medium ${tab === "import" ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]" : themeClasses.textMuted}`}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            导入目录包
          </button>
          <button
            type="button"
            onClick={() => setTab("export")}
            className={`flex h-9 items-center justify-center gap-2 rounded-md text-xs font-medium ${tab === "export" ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]" : themeClasses.textMuted}`}
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            导出当前项目
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "import" ? (
            <section className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handlePackage(file);
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                disabled={isPicking || importBusy}
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-between rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--control-bg)] px-4 py-4 text-left transition hover:border-sky-400/60 hover:bg-[var(--control-bg-hover)] disabled:opacity-60"
              >
                <span className="flex items-center gap-3">
                  <FileArchive className="h-5 w-5 text-sky-400" />
                  <span>
                    <span
                      className={`block text-sm font-medium ${themeClasses.textPrimary}`}
                    >
                      {isPicking ? "正在读取并预检…" : "选择 .zip 目录包"}
                    </span>
                    <span
                      className={`mt-1 block text-[11px] ${themeClasses.textMuted}`}
                    >
                      服务端会校验版本、资产引用和容量
                    </span>
                  </span>
                </span>
                {isPicking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                ) : (
                  <ArrowDownToLine className="h-4 w-4 text-[var(--text-muted)]" />
                )}
              </button>
              {importSummary ? (
                <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div
                        className={`text-sm font-semibold ${themeClasses.textPrimary}`}
                      >
                        {importSummary.project.name}
                      </div>
                      <div
                        className={`mt-1 text-[11px] ${themeClasses.textMuted}`}
                      >
                        源版本 {importSummary.project.version} · 序列{" "}
                        {importSummary.project.sequence}
                      </div>
                    </div>
                    <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-semibold text-sky-300">
                      {statusLabel(importSummary.status)}
                    </span>
                  </div>
                  <ProgressBar
                    value={importBusy ? uploadProgress : importPercent}
                  />
                  <div
                    className={`flex justify-between text-[10px] ${themeClasses.textMuted}`}
                  >
                    <span>
                      {importBusy
                        ? `上传 ${Math.round(uploadProgress)}%`
                        : `${importSummary.progress.completedFileCount}/${importSummary.estimates.fileCount} 个文件`}
                    </span>
                    <span>
                      {formatBytes(importSummary.estimates.totalBytes)}
                    </span>
                  </div>
                  {importSummary.conflict.requiresResolution ? (
                    <div className="rounded-md border border-amber-400/25 bg-amber-400/10 p-3">
                      <div className="flex gap-2">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-amber-200">
                            目标项目存在冲突
                          </div>
                          <div className="mt-1 text-[11px] leading-5 text-amber-100/80">
                            当前目标版本{" "}
                            {importSummary.conflict.targetProject
                              ?.expectedVersion ?? "-"}{" "}
                            · 序列{" "}
                            {importSummary.conflict.targetProject
                              ?.expectedSequence ?? "-"}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <select
                              value={strategy}
                              onChange={(event) => {
                                setStrategy(
                                  event.target.value as "copy" | "replace",
                                );
                                setReplaceConfirmed(false);
                              }}
                              className="h-8 rounded-md border border-amber-300/20 bg-black/20 px-2 text-[11px] text-amber-50"
                            >
                              {importSummary.allowedStrategies.includes(
                                "copy",
                              ) ? (
                                <option value="copy">复制为新项目</option>
                              ) : null}
                              {importSummary.allowedStrategies.includes(
                                "replace",
                              ) ? (
                                <option value="replace">替换目标项目</option>
                              ) : null}
                            </select>
                            {strategy === "replace" ? (
                              <label className="flex items-center gap-1.5 text-[11px] text-amber-100">
                                <input
                                  type="checkbox"
                                  checked={replaceConfirmed}
                                  onChange={(event) =>
                                    setReplaceConfirmed(event.target.checked)
                                  }
                                />
                                我确认按上述版本替换
                              </label>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    {["prepared", "ready"].includes(importSummary.status) &&
                    importSummary.allowedStrategies.length > 0 ? (
                      <button
                        type="button"
                        disabled={
                          importBusy ||
                          (strategy === "replace" && !replaceConfirmed)
                        }
                        onClick={() => void handleCommit()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-400 px-3 text-[11px] font-semibold text-slate-950 disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" />
                        提交导入
                      </button>
                    ) : null}
                    {[
                      "prepared",
                      "uploading",
                      "validating",
                      "ready",
                      "committing",
                    ].includes(importSummary.status) ? (
                      <button
                        type="button"
                        disabled={importBusy}
                        onClick={() => void cancelImport()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] font-medium text-[var(--text-secondary)]"
                      >
                        <X className="h-3.5 w-3.5" />
                        取消
                      </button>
                    ) : null}
                    {["completed", "canceled", "expired", "failed"].includes(
                      importSummary.status,
                    ) ? (
                      <button
                        type="button"
                        onClick={clearImport}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] font-medium text-[var(--text-secondary)]"
                      >
                        清除记录
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="space-y-4">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] p-4">
                <div
                  className={`text-sm font-semibold ${themeClasses.textPrimary}`}
                >
                  {activeProject?.name ?? "未选择项目"}
                </div>
                <div className={`mt-1 text-[11px] ${themeClasses.textMuted}`}>
                  导出会冻结当前项目版本，生成短期私有下载地址
                </div>
                <button
                  type="button"
                  disabled={
                    !activeProjectId ||
                    exportBusy ||
                    Boolean(
                      exportSummary &&
                      ["prepared", "generating"].includes(exportSummary.status),
                    )
                  }
                  onClick={() => void handleExport()}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-violet-400 px-3 text-xs font-semibold text-slate-950 disabled:opacity-40"
                >
                  <ArrowUpFromLine className="h-3.5 w-3.5" />
                  开始导出
                </button>
              </div>
              {exportSummary ? (
                <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div
                        className={`text-sm font-semibold ${themeClasses.textPrimary}`}
                      >
                        {exportSummary.project.name}
                      </div>
                      <div
                        className={`mt-1 text-[11px] ${themeClasses.textMuted}`}
                      >
                        冻结版本 {exportSummary.project.version} · 序列{" "}
                        {exportSummary.project.sequence}
                      </div>
                    </div>
                    <span className="rounded-full bg-violet-400/10 px-2 py-1 text-[10px] font-semibold text-violet-200">
                      {statusLabel(exportSummary.status)}
                    </span>
                  </div>
                  <ProgressBar value={exportPercent} />
                  <div className={`text-[10px] ${themeClasses.textMuted}`}>
                    {exportSummary.progress.completedFileCount}/
                    {exportSummary.progress.fileCount} 个文件 ·{" "}
                    {formatBytes(exportSummary.progress.completedBytes)} /{" "}
                    {formatBytes(exportSummary.progress.totalBytes)}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {exportSummary.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => void handleDownload()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-400 px-3 text-[11px] font-semibold text-slate-950"
                      >
                        <Download className="h-3.5 w-3.5" />
                        下载目录包
                      </button>
                    ) : null}
                    {["prepared", "generating"].includes(
                      exportSummary.status,
                    ) ? (
                      <button
                        type="button"
                        disabled={exportBusy}
                        onClick={() => void cancelExport()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] text-[var(--text-secondary)]"
                      >
                        <X className="h-3.5 w-3.5" />
                        取消
                      </button>
                    ) : null}
                    {exportSummary.status === "failed" ? (
                      <button
                        type="button"
                        disabled={exportBusy}
                        onClick={() => void retryExport()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] text-[var(--text-secondary)]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        重试
                      </button>
                    ) : null}
                    {["completed", "canceled", "expired"].includes(
                      exportSummary.status,
                    ) ? (
                      <button
                        type="button"
                        onClick={clearExport}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] text-[var(--text-secondary)]"
                      >
                        清除记录
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          )}
          {error ? (
            <div className="mt-4 rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-5 text-red-200">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
              {versionConflict ? (
                <div className="mt-2 flex flex-wrap gap-2 pl-5">
                  <button
                    type="button"
                    onClick={() =>
                      void useProjectStore.getState().reloadFromWorkspace()
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-red-300/25 px-2"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重新加载云端项目
                  </button>
                  {importSummary?.allowedStrategies.includes("copy") ? (
                    <button
                      type="button"
                      onClick={() => {
                        setStrategy("copy");
                        void handleCommit("copy");
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-red-200 px-2 font-semibold text-red-950"
                    >
                      <ArrowDownToLine className="h-3 w-3" />
                      复制为新项目
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] px-5 py-3">
          <span className={`text-[10px] ${themeClasses.textMuted}`}>
            迁移状态以服务端任务、资产和项目图为准
          </span>
          <button
            type="button"
            onClick={() => void useMigrationStore.getState().hydrate()}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] ${themeClasses.textMuted} hover:bg-[var(--control-bg-hover)]`}
          >
            <RefreshCw className="h-3 w-3" />
            刷新状态
          </button>
        </footer>
      </div>
    </div>
  );
}
