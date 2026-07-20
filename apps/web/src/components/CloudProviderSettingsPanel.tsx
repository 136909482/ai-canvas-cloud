import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react'
import type { ProviderSettingSummary } from '@ai-canvas-cloud/contracts'
import { cloudProviderSettingsApi } from '@/api/providerSettings'
import { useCloudProviderStore } from '@/store/useCloudProviderStore'
import { useFeedbackStore } from '@/store/useFeedbackStore'
import { themeClasses } from '@/styles/themeClasses'

type ProviderDraft = { label: string; websiteUrl: string; baseUrl: string; apiKey: string }

const PROVIDER_FIELD_CLASS = 'h-8.5 w-full rounded-[9px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 text-[13px] text-[var(--text-primary)] outline-none transition focus:border-violet-400/60'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '服务商设置请求失败'
}

function createProviderId() {
  return crypto.randomUUID().toLowerCase()
}

export function CloudProviderSettingsPanel({ active }: { active: boolean }) {
  const providers = useCloudProviderStore((state) => state.providers)
  const loading = useCloudProviderStore((state) => state.loading)
  const loadError = useCloudProviderStore((state) => state.error)
  const load = useCloudProviderStore((state) => state.load)
  const upsert = useCloudProviderStore((state) => state.upsert)
  const removeFromStore = useCloudProviderStore((state) => state.remove)
  const notify = useFeedbackStore((state) => state.notify)
  const confirm = useFeedbackStore((state) => state.confirm)
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({})
  const [newProviderId, setNewProviderId] = useState<string | null>(null)
  const [pendingProvider, setPendingProvider] = useState<string | null>(null)
  const [showKeyByProvider, setShowKeyByProvider] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (active) void load()
  }, [active, load])

  useEffect(() => {
    setDrafts((current) => Object.fromEntries(providers.map((provider) => [
      provider.providerId,
      current[provider.providerId] ?? { label: provider.label, websiteUrl: provider.websiteUrl, baseUrl: provider.baseUrl, apiKey: '' },
    ])))
  }, [providers])

  const patchDraft = (providerId: string, patch: Partial<ProviderDraft>) => {
    setDrafts((current) => ({
      ...current,
      [providerId]: { ...(current[providerId] ?? { label: '', websiteUrl: '', baseUrl: '', apiKey: '' }), ...patch },
    }))
  }

  const addProvider = () => {
    const providerId = createProviderId()
    setNewProviderId(providerId)
    setDrafts((current) => ({
      ...current,
      [providerId]: { label: '', websiteUrl: 'https://', baseUrl: 'https://', apiKey: '' },
    }))
  }

  const saveProvider = async (providerId: string, existing?: ProviderSettingSummary) => {
    const draft = drafts[providerId]
    if (!draft?.label.trim() || !draft.websiteUrl.trim() || !draft.baseUrl.trim() || (!existing && !draft.apiKey.trim())) {
      notify({ tone: 'error', title: '信息不完整', message: '请填写供应商名称、官网链接、API 请求地址和 API Key。' })
      return
    }
    setPendingProvider(providerId)
    try {
      const response = await cloudProviderSettingsApi.update(providerId, {
        label: draft.label.trim(),
        websiteUrl: draft.websiteUrl.trim(),
        baseUrl: draft.baseUrl.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      })
      upsert(response.provider)
      patchDraft(providerId, { label: response.provider.label, websiteUrl: response.provider.websiteUrl, baseUrl: response.provider.baseUrl, apiKey: '' })
      setNewProviderId((current) => current === providerId ? null : current)
      notify({ tone: 'success', title: '服务商已保存', message: `${response.provider.label} 已保存到你的账号。` })
    } catch (error) {
      notify({ tone: 'error', title: '服务商保存失败', message: getErrorMessage(error) })
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
    const confirmed = await confirm({
      title: '删除服务商',
      message: `删除 ${provider.label} 后，已绑定它的模型需要重新选择服务商。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
    setPendingProvider(provider.providerId)
    try {
      await cloudProviderSettingsApi.remove(provider.providerId)
      removeFromStore(provider.providerId)
      notify({ tone: 'success', title: '服务商已删除', message: `${provider.label} 的服务端密钥已删除。` })
    } catch (error) {
      notify({ tone: 'error', title: '删除服务商失败', message: getErrorMessage(error) })
    } finally {
      setPendingProvider(null)
    }
  }

  const cards: Array<{ providerId: string; provider?: ProviderSettingSummary }> = [
    ...providers.map((provider) => ({ providerId: provider.providerId, provider })),
    ...(newProviderId ? [{ providerId: newProviderId }] : []),
  ]

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className={`flex items-start justify-between gap-4 text-xs leading-5 ${themeClasses.textMuted}`}>
        <p>在这里统一管理服务商。模型设置只选择服务商，不再保存 URL 或密钥。新增服务商默认使用 OpenAI Compatible 协议。</p>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => void load()} className={`${themeClasses.iconButton} h-8 w-8 rounded-lg`} aria-label="刷新服务商"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={addProvider} disabled={Boolean(newProviderId)} className={`${themeClasses.secondaryButton} h-8 gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-50`}><Plus className="h-3.5 w-3.5" />添加服务商</button>
        </div>
      </div>

      {loadError && cards.length === 0 ? <p className="rounded-lg border border-red-400/20 bg-red-500/10 p-4 text-xs text-red-300">{loadError}</p> : null}
      {!loading && cards.length === 0 ? <div className={`rounded-lg border border-dashed border-[var(--border-subtle)] px-6 py-12 text-center text-sm ${themeClasses.textMuted}`}>暂无服务商，点击“添加服务商”开始配置。</div> : null}

      {cards.map(({ providerId, provider }) => {
        const draft = drafts[providerId] ?? { label: provider?.label ?? '', websiteUrl: provider?.websiteUrl ?? '', baseUrl: provider?.baseUrl ?? '', apiKey: '' }
        const pending = pendingProvider === providerId
        return (
          <section key={providerId} className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)]">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5">
              <div><h3 className={`text-sm font-medium ${themeClasses.textPrimary}`}>{provider?.label || '新服务商'}</h3>{provider ? <p className={`mt-1 text-[11px] ${themeClasses.textMuted}`}>密钥末四位 {provider.secretLastFour ?? '----'}</p> : null}</div>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${provider ? 'bg-emerald-400/10 text-emerald-300' : 'bg-[var(--control-bg-hover)] text-[var(--text-muted)]'}`}>{provider ? <CheckCircle2 className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}{provider ? '已配置' : '未保存'}</span>
            </header>
            <div className="grid gap-3 px-4 py-4">
              <label className="block"><span className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}>供应商名称</span><input value={draft.label} onChange={(event) => patchDraft(providerId, { label: event.target.value })} placeholder="Krill / OpenAI / 阿里百炼" className={PROVIDER_FIELD_CLASS} /></label>
              <label className="block"><span className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}>官网链接</span><input type="url" value={draft.websiteUrl} onChange={(event) => patchDraft(providerId, { websiteUrl: event.target.value })} placeholder="https://example.com" className={PROVIDER_FIELD_CLASS} /></label>
              <label className="block"><span className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}>API 请求地址</span><input type="url" value={draft.baseUrl} onChange={(event) => patchDraft(providerId, { baseUrl: event.target.value })} placeholder="https://api.example.com/v1" className={PROVIDER_FIELD_CLASS} /></label>
              <label className="block"><span className={`mb-1.5 block text-xs font-semibold ${themeClasses.textSecondary}`}>API Key</span><span className="relative block"><input type={showKeyByProvider[providerId] ? 'text' : 'password'} value={draft.apiKey} onChange={(event) => patchDraft(providerId, { apiKey: event.target.value })} placeholder={provider ? '留空表示不更换密钥' : '输入 API Key'} autoComplete="off" className={`${PROVIDER_FIELD_CLASS} pr-10`} /><button type="button" onClick={() => setShowKeyByProvider((current) => ({ ...current, [providerId]: !current[providerId] }))} className="absolute right-1.5 top-1/2 inline-flex h-6.5 w-6.5 -translate-y-1/2 items-center justify-center rounded-[7px] text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)]">{showKeyByProvider[providerId] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button></span></label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-4 py-3">
              {provider ? <button type="button" disabled={pending} onClick={() => void testProvider(provider)} className={`${themeClasses.secondaryButton} h-8 gap-1.5 rounded-lg px-3 text-xs`}><Wifi className="h-3.5 w-3.5" />测试连接</button> : null}
              {provider ? <button type="button" disabled={pending} onClick={() => void removeProvider(provider)} className={`${themeClasses.iconButton} h-8 w-8 rounded-lg text-red-500`}><Trash2 className="h-3.5 w-3.5" /></button> : <button type="button" onClick={() => { setNewProviderId(null); setDrafts((current) => { const next = { ...current }; delete next[providerId]; return next }) }} className={`${themeClasses.secondaryButton} h-8 rounded-lg px-3 text-xs`}>取消</button>}
              <button type="button" disabled={pending} onClick={() => void saveProvider(providerId, provider)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-500 px-3 text-xs font-medium text-white disabled:opacity-60">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}保存</button>
            </footer>
          </section>
        )
      })}
    </div>
  )
}
