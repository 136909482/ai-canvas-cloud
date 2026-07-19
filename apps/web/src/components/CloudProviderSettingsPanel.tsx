import { useEffect, useState } from 'react'
import type { CloudProviderId, ProviderSettingSummary } from '@ai-canvas-cloud/contracts'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Trash2, Wifi } from 'lucide-react'
import { cloudProviderSettingsApi } from '@/api/providerSettings'
import { useFeedbackStore } from '@/store/useFeedbackStore'
import { themeClasses } from '@/styles/themeClasses'

const providerIds: CloudProviderId[] = ['openai', 'aliyun']

function isConfigured(provider: ProviderSettingSummary) {
  return provider.configured && provider.status === 'active'
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '服务商设置请求失败'
}

export function CloudProviderSettingsPanel({ active }: { active: boolean }) {
  const notify = useFeedbackStore((state) => state.notify)
  const [providers, setProviders] = useState<ProviderSettingSummary[]>([])
  const [apiKeyByProvider, setApiKeyByProvider] = useState<Partial<Record<CloudProviderId, string>>>({})
  const [baseUrlByProvider, setBaseUrlByProvider] = useState<Partial<Record<CloudProviderId, string>>>({})
  const [showKeyByProvider, setShowKeyByProvider] = useState<Partial<Record<CloudProviderId, boolean>>>({})
  const [pendingProvider, setPendingProvider] = useState<CloudProviderId | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    void cloudProviderSettingsApi.list()
      .then((response) => {
        if (cancelled) return
        setProviders(response.providers)
        setBaseUrlByProvider((current) => Object.fromEntries(
          response.providers.map((provider) => [provider.providerId, current[provider.providerId] ?? provider.baseUrl]),
        ))
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [active, refreshToken])

  useEffect(() => {
    if (!active) {
      setApiKeyByProvider({})
      setShowKeyByProvider({})
    }
  }, [active])

  const updateProvider = async (provider: ProviderSettingSummary) => {
    const apiKey = apiKeyByProvider[provider.providerId]?.trim() ?? ''
    if (!apiKey) {
      notify({ tone: 'error', title: '请输入 API Key', message: '更新 Cloud 服务商配置需要新的 API Key。' })
      return
    }
    setPendingProvider(provider.providerId)
    try {
      const response = await cloudProviderSettingsApi.update(provider.providerId, {
        apiKey,
        baseUrl: baseUrlByProvider[provider.providerId]?.trim() || undefined,
      })
      setProviders((current) => current.map((item) => item.providerId === provider.providerId ? response.provider : item))
      setApiKeyByProvider((current) => ({ ...current, [provider.providerId]: '' }))
      setShowKeyByProvider((current) => ({ ...current, [provider.providerId]: false }))
      setBaseUrlByProvider((current) => ({ ...current, [provider.providerId]: response.provider.baseUrl }))
      notify({ tone: 'success', title: '服务商已更新', message: `${response.provider.label} 已保存到当前 Cloud 工作区。` })
    } catch (error) {
      notify({ tone: 'error', title: '服务商更新失败', message: getErrorMessage(error) })
    } finally {
      setPendingProvider(null)
    }
  }

  const testProvider = async (provider: ProviderSettingSummary) => {
    setPendingProvider(provider.providerId)
    try {
      await cloudProviderSettingsApi.test(provider.providerId)
      notify({ tone: 'success', title: '连接正常', message: `${provider.label} 已通过服务端连接测试。` })
    } catch (error) {
      notify({ tone: 'error', title: '连接测试失败', message: getErrorMessage(error) })
    } finally {
      setPendingProvider(null)
    }
  }

  const removeProvider = async (provider: ProviderSettingSummary) => {
    setPendingProvider(provider.providerId)
    try {
      await cloudProviderSettingsApi.remove(provider.providerId)
      setProviders((current) => current.map((item) => item.providerId === provider.providerId ? {
        ...item, configured: false, status: 'not_configured', secretLastFour: null, updatedAt: null,
      } : item))
      setApiKeyByProvider((current) => ({ ...current, [provider.providerId]: '' }))
      setShowKeyByProvider((current) => ({ ...current, [provider.providerId]: false }))
      notify({ tone: 'success', title: '服务商已移除', message: `${provider.label} 的 Cloud 凭据已删除。` })
    } catch (error) {
      notify({ tone: 'error', title: '移除服务商失败', message: getErrorMessage(error) })
    } finally {
      setPendingProvider(null)
    }
  }

  const displayedProviders = providerIds.map((providerId) => providers.find((provider) => provider.providerId === providerId)).filter(
    (provider): provider is ProviderSettingSummary => Boolean(provider),
  )

  if (isLoading && displayedProviders.length === 0) {
    return <div className="h-56 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)]" />
  }

  if (loadError && displayedProviders.length === 0) {
    return (
      <section className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--control-bg)] px-6 text-center">
        <KeyRound className="h-6 w-6 text-[var(--text-muted)]" />
        <h3 className={`mt-3 text-sm font-medium ${themeClasses.textPrimary}`}>无法读取服务商配置</h3>
        <p className={`mt-1 text-xs ${themeClasses.textMuted}`}>{loadError}</p>
        <button type="button" onClick={() => setRefreshToken((value) => value + 1)} className={`${themeClasses.secondaryButton} mt-4 h-8 gap-1.5 rounded-lg px-3 text-xs font-medium`}>
          <RefreshCw className="h-3.5 w-3.5" />重新加载
        </button>
      </section>
    )
  }

  return (
    <div className="space-y-4" aria-busy={isLoading}>
      <div className={`flex items-start justify-between gap-4 text-xs leading-5 ${themeClasses.textMuted}`}>
        <p>密钥仅用于本次提交并加密保存到当前 Cloud 工作区，浏览器不会保留或同步到本地模型配置。</p>
        <button type="button" onClick={() => setRefreshToken((value) => value + 1)} className={`${themeClasses.iconButton} h-7 w-7 shrink-0 rounded-lg`} aria-label="刷新服务商配置" title="刷新服务商配置">
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {displayedProviders.map((provider) => {
        const configured = isConfigured(provider)
        const pending = pendingProvider === provider.providerId
        const apiKey = apiKeyByProvider[provider.providerId] ?? ''
        return (
          <section key={provider.providerId} className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)]">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5">
              <div className="min-w-0">
                <h3 className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{provider.label}</h3>
                <p className={`mt-1 text-[11px] ${themeClasses.textMuted}`}>{configured ? `已配置，密钥末四位 ${provider.secretLastFour ?? '----'}` : '尚未配置'}</p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${configured ? 'bg-emerald-400/10 text-emerald-600 dark:text-emerald-200' : 'bg-[var(--control-bg-hover)] text-[var(--text-muted)]'}`}>
                {configured ? <CheckCircle2 className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
                {configured ? '已配置' : '未配置'}
              </span>
            </header>
            <div className="space-y-3 px-4 py-4">
              <label className="block">
                <span className={`mb-1.5 block text-xs ${themeClasses.textSecondary}`}>API Key</span>
                <span className="relative block">
                  <input type={showKeyByProvider[provider.providerId] ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKeyByProvider((current) => ({ ...current, [provider.providerId]: event.target.value }))} placeholder={configured ? '输入新密钥以更新' : '输入 API Key'} autoComplete="off" spellCheck={false} className="h-8.5 w-full rounded-[9px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 pr-10 text-[13px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-violet-400/60" />
                  <button type="button" onClick={() => setShowKeyByProvider((current) => ({ ...current, [provider.providerId]: !current[provider.providerId] }))} className="absolute right-1.5 top-1/2 inline-flex h-6.5 w-6.5 -translate-y-1/2 items-center justify-center rounded-[7px] text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)]" aria-label={showKeyByProvider[provider.providerId] ? '隐藏 API Key' : '显示 API Key'}>
                    {showKeyByProvider[provider.providerId] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </span>
              </label>
              <label className="block">
                <span className={`mb-1.5 block text-xs ${themeClasses.textSecondary}`}>服务地址</span>
                <input type="url" value={baseUrlByProvider[provider.providerId] ?? provider.baseUrl} onChange={(event) => setBaseUrlByProvider((current) => ({ ...current, [provider.providerId]: event.target.value }))} autoComplete="off" spellCheck={false} className="h-8.5 w-full rounded-[9px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 text-[13px] text-[var(--text-primary)] outline-none transition focus:border-violet-400/60" />
              </label>
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-4 py-3">
              {configured ? <button type="button" disabled={pending} onClick={() => void testProvider(provider)} className={`${themeClasses.secondaryButton} h-8 gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-60`}><Wifi className="h-3.5 w-3.5" />测试连接</button> : null}
              {configured ? <button type="button" disabled={pending} onClick={() => void removeProvider(provider)} className={`${themeClasses.iconButton} h-8 w-8 rounded-lg text-red-500 hover:text-red-400 disabled:opacity-60`} aria-label={`移除 ${provider.label}`} title={`移除 ${provider.label}`}><Trash2 className="h-3.5 w-3.5" /></button> : null}
              <button type="button" disabled={pending || !apiKey.trim()} onClick={() => void updateProvider(provider)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-500 px-3 text-xs font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}{configured ? '更新密钥' : '保存密钥'}
              </button>
            </footer>
          </section>
        )
      })}
    </div>
  )
}
