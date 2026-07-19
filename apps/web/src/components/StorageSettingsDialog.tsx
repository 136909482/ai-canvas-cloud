import { useEffect, useState } from 'react'
import type { WorkspaceUsageResponse } from '@ai-canvas-cloud/contracts'
import { AlertTriangle, Archive, Cloud, FileIcon, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react'
import { requestCloudJson } from '@/api/cloudApiClient'
import { useAuthStore } from '@/features/auth/useAuthStore'
import { formatStorageBytes, getStorageUsagePercentage } from '@/features/storage/storageOverview'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { useStorageDialogStore } from '@/store/useStorageDialogStore'
import { themeClasses } from '@/styles/themeClasses'

function getProgressTone(percentage: number) {
  if (percentage >= 100) {
    return 'bg-red-500'
  }
  if (percentage >= 85) {
    return 'bg-amber-400'
  }
  return 'bg-emerald-500'
}

function StorageOverviewSkeleton() {
  return (
    <div className="space-y-4" aria-label="正在加载存储用量">
      <div className="h-32 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)]" />
      <div className="h-64 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)]" />
    </div>
  )
}

export function StorageSettingsPanel({ active = true }: { active?: boolean }) {
  const workspace = useAuthStore((state) => state.session?.workspace)
  const [usage, setUsage] = useState<WorkspaceUsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    void requestCloudJson<WorkspaceUsageResponse>('/workspaces/current/usage')
      .then((response) => {
        if (!cancelled) {
          setUsage(response)
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : String(requestError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [active, refreshKey])

  if (isLoading && !usage) {
    return <StorageOverviewSkeleton />
  }

  if (error && !usage) {
    return (
      <section className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--control-bg)] px-6 text-center">
        <Cloud className="h-6 w-6 text-[var(--text-muted)]" />
        <h3 className={`mt-3 text-sm font-medium ${themeClasses.textPrimary}`}>暂时无法读取存储用量</h3>
        <p className={`mt-1 max-w-md text-xs leading-5 ${themeClasses.textMuted}`}>{error}</p>
        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          className={`${themeClasses.secondaryButton} mt-4 h-8 gap-1.5 rounded-lg px-3 text-xs font-medium`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重新加载
        </button>
      </section>
    )
  }

  if (!usage) {
    return null
  }

  const percentage = getStorageUsagePercentage(usage.storage.totalBytes, usage.storage.quotaBytes)
  const isNearlyFull = percentage >= 90
  const workspaceLabel = workspace?.type === 'team' ? '团队云空间' : '个人云空间'

  return (
    <div className="flex flex-col gap-4" aria-busy={isLoading}>
      <section className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <Cloud className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-300" />
              <h3 className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>存储概况</h3>
            </div>
            <div className="flex items-center gap-2">
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" /> : null}
              <span className="rounded-full bg-[var(--control-bg-hover)] px-2.5 py-1 text-[11px] text-[var(--text-muted)]">
                {workspaceLabel}
              </span>
            </div>
          </div>

          <div className="mt-5 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className={`text-[22px] font-semibold leading-none ${themeClasses.textPrimary}`}>
                {formatStorageBytes(usage.storage.totalBytes)}
                <span className={`ml-1.5 text-sm font-normal ${themeClasses.textMuted}`}>
                  / {formatStorageBytes(usage.storage.quotaBytes)}
                </span>
              </div>
              <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${themeClasses.textMuted}`}>
                <span>已存储 {formatStorageBytes(usage.storage.usedBytes)}</span>
                {usage.storage.reservedBytes > 0 ? (
                  <span>处理中 {formatStorageBytes(usage.storage.reservedBytes)}</span>
                ) : null}
                <span>剩余 {formatStorageBytes(usage.storage.availableBytes)}</span>
              </div>
            </div>
            <span
              className={`shrink-0 text-sm font-medium ${isNearlyFull ? 'text-amber-500 dark:text-amber-300' : themeClasses.textSecondary}`}
            >
              {percentage}%
            </span>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--control-bg-hover)]" aria-hidden="true">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${getProgressTone(percentage)}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        {isNearlyFull ? (
          <div className="flex items-start gap-2 border-t border-amber-400/20 bg-amber-400/8 px-4 py-3 text-xs leading-5 text-amber-700 dark:text-amber-200 sm:px-5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>存储空间即将用满。删除不再需要的项目或文件后，空间会在资产回收完成后释放。</span>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-sky-500 dark:text-sky-300" />
            <h3 className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>项目存储明细</h3>
          </div>
          <span className={`shrink-0 text-xs ${themeClasses.textMuted}`}>{usage.projects.length} 个项目</span>
        </header>

        {usage.projects.length > 0 ? (
          <div>
            {usage.projects.map((project) => {
              const projectShare =
                usage.storage.totalBytes > 0 ? Math.round((project.storageBytes / usage.storage.totalBytes) * 100) : 0

              return (
                <div
                  key={project.projectId}
                  className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0 hover:bg-[var(--control-bg-hover)] sm:px-5"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{project.name}</span>
                      {project.archivedAt ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--control-bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                          <Archive className="h-2.5 w-2.5" />
                          已归档
                        </span>
                      ) : null}
                    </div>
                    <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-[11px] ${themeClasses.textMuted}`}>
                      <span className="inline-flex items-center gap-1">
                        <FileIcon className="h-3 w-3" />
                        {project.fileCount} 个文件
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{project.nodeCount} 个节点</span>
                    </div>
                  </div>

                  <div className="min-w-20 text-right">
                    <div className={`text-sm font-medium tabular-nums ${themeClasses.textSecondary}`}>
                      {formatStorageBytes(project.storageBytes)}
                    </div>
                    <div className={`mt-1 text-[11px] tabular-nums ${themeClasses.textMuted}`}>{projectShare}%</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
            <FolderOpen className="h-6 w-6 text-[var(--text-muted)]" />
            <h4 className={`mt-3 text-sm font-medium ${themeClasses.textPrimary}`}>还没有项目</h4>
            <p className={`mt-1 text-xs ${themeClasses.textMuted}`}>创建项目后，文件和节点用量会显示在这里。</p>
          </div>
        )}
      </section>
    </div>
  )
}

export function StorageSettingsDialog() {
  const isOpen = useStorageDialogStore((state) => state.isOpen)
  const close = useStorageDialogStore((state) => state.close)
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, close)

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-settings-title"
        tabIndex={-1}
        className={`max-h-[min(760px,calc(100vh-2rem))] w-full max-w-3xl overflow-hidden rounded-xl ${themeClasses.strongPanel}`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 id="storage-settings-title" className={`text-lg font-semibold ${themeClasses.textPrimary}`}>
            存储管理
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="关闭存储管理"
            className={`${themeClasses.iconButton} h-8 w-8 rounded-lg`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(100vh-7rem)] overflow-y-auto p-5">
          <StorageSettingsPanel active={isOpen} />
        </div>
      </div>
    </div>
  )
}
