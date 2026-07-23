import { useEffect, useState } from 'react'
import {
  Boxes,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Plus,
  Server,
  Trash2,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { PROVIDERS, getProviderDefinition } from '@/config/modelCatalog'
import { useFeedbackStore } from '@/store/useFeedbackStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { themeClasses } from '@/styles/themeClasses'
import type { CustomModelKind } from '@/types'
import {
  FIELD_INPUT_CLASS,
  FIELD_SELECT_CLASS,
  MODEL_TABS,
  createEmptyDraft,
  createEmptyProviderDraft,
  cx,
  sanitizeDraftModel,
  sanitizeProviderProfile,
  toDraftModel,
  toDraftProviderProfile,
  type DraftModelCard,
  type DraftProviderProfile,
} from '@/components/toolbar/settingsModel'
import {
  getModelDraftValidationMessage,
  validateProviderProfileDraft,
} from './providerConfig'
import { testProviderEndpointDirect } from './providerEndpoint'

type LibraryView = 'providers' | 'models'

function getKindLabel(kind: CustomModelKind) {
  return MODEL_TABS.find((tab) => tab.id === kind)?.label ?? kind
}

export function LocalVaultSettingsPanel() {
  const {
    config,
    deleteCustomModel,
    deleteProviderProfile,
    persistLocalVault,
    saveCustomModel,
    saveProviderProfile,
    setActiveProviderProfile,
    setDefaultModel,
    setModelProviderProfile,
  } = useSettingsStore(useShallow((state) => ({
    config: state.config,
    deleteCustomModel: state.deleteCustomModel,
    deleteProviderProfile: state.deleteProviderProfile,
    persistLocalVault: state.persistLocalVault,
    saveCustomModel: state.saveCustomModel,
    saveProviderProfile: state.saveProviderProfile,
    setActiveProviderProfile: state.setActiveProviderProfile,
    setDefaultModel: state.setDefaultModel,
    setModelProviderProfile: state.setModelProviderProfile,
  })))
  const notify = useFeedbackStore((state) => state.notify)
  const confirm = useFeedbackStore((state) => state.confirm)
  const [view, setView] = useState<LibraryView>('providers')
  const [activeKind, setActiveKind] = useState<CustomModelKind>('image')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [providerDraft, setProviderDraft] = useState<DraftProviderProfile | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<DraftModelCard | null>(null)
  const [modelProviderId, setModelProviderId] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const providersForKind = config.providerProfiles.filter((profile) => profile.kind === activeKind)
  const modelsForKind = config.customModels.filter((model) => model.kind === activeKind)

  useEffect(() => {
    if (providerDraft && (providerDraft.id === selectedProviderId || selectedProviderId?.startsWith('draft-provider-'))) {
      return
    }
    const selected = config.providerProfiles.find((profile) => profile.id === selectedProviderId)
      ?? providersForKind[0]
      ?? null
    setSelectedProviderId(selected?.id ?? null)
    setProviderDraft(selected ? toDraftProviderProfile(selected) : null)
  }, [config.providerProfiles, providerDraft, providersForKind, selectedProviderId])

  useEffect(() => {
    if (modelDraft && (modelDraft.id === selectedModelId || selectedModelId?.startsWith('draft-model-'))) {
      return
    }
    const selected = config.customModels.find((model) => model.id === selectedModelId)
      ?? modelsForKind[0]
      ?? null
    setSelectedModelId(selected?.id ?? null)
    setModelDraft(selected ? toDraftModel(selected) : null)
    setModelProviderId(selected ? config.modelProviderProfileIds[selected.modelId] ?? '' : '')
  }, [config.customModels, config.modelProviderProfileIds, modelDraft, modelsForKind, selectedModelId])

  const selectProvider = (id: string) => {
    const profile = config.providerProfiles.find((item) => item.id === id) ?? null
    setSelectedProviderId(profile?.id ?? null)
    setProviderDraft(profile ? toDraftProviderProfile(profile) : null)
    setShowApiKey(false)
  }

  const selectModel = (id: string) => {
    const model = config.customModels.find((item) => item.id === id) ?? null
    setSelectedModelId(model?.id ?? null)
    setModelDraft(model ? toDraftModel(model) : null)
    setModelProviderId(model ? config.modelProviderProfileIds[model.modelId] ?? '' : '')
  }

  const handleAddProvider = () => {
    const draft = createEmptyProviderDraft(activeKind)
    setSelectedProviderId(draft.id)
    setProviderDraft(draft)
    setShowApiKey(false)
  }

  const handleSaveProvider = async () => {
    if (!providerDraft) return
    const sanitized = sanitizeProviderProfile(providerDraft)
    const diagnostic = validateProviderProfileDraft(sanitized)
    if (diagnostic) {
      setProviderDraft({ ...sanitized, testStatus: 'error', testMessage: diagnostic.message })
      return
    }

    setBusyAction('save-provider')
    try {
      saveProviderProfile(sanitized)
      await persistLocalVault()
      setSelectedProviderId(sanitized.id)
      setProviderDraft(sanitized)
      notify({ title: '服务商已保存到本地 Vault', tone: 'success' })
    } catch {
      notify({ title: '服务商保存失败', tone: 'error' })
    } finally {
      setBusyAction(null)
    }
  }

  const handleTestProvider = async () => {
    if (!providerDraft) return
    const sanitized = sanitizeProviderProfile(providerDraft)
    setProviderDraft({ ...sanitized, testStatus: 'testing', testMessage: '正在测试连接…' })
    setBusyAction('test-provider')
    try {
      await testProviderEndpointDirect(sanitized)
      setProviderDraft({
        ...sanitized,
        testStatus: 'success',
        testMessage: '连接成功，服务商凭据可用。',
        lastTestedAt: Date.now(),
      })
    } catch (error) {
      setProviderDraft({
        ...sanitized,
        testStatus: 'error',
        testMessage: error instanceof Error ? error.message : '连接测试失败',
        lastTestedAt: Date.now(),
      })
    }
    setBusyAction(null)
  }

  const handleDeleteProvider = async () => {
    if (!providerDraft || providerDraft.id.startsWith('draft-provider-')) {
      setProviderDraft(null)
      setSelectedProviderId(null)
      return
    }
    const confirmed = await confirm({
      title: '删除服务商',
      message: '使用该服务商的模型绑定会同时移除。',
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (!confirmed) return
    deleteProviderProfile(providerDraft.id)
    await persistLocalVault().catch(() => undefined)
    setProviderDraft(null)
    setSelectedProviderId(null)
  }

  const handleAddModel = () => {
    const draft = createEmptyDraft(activeKind)
    setSelectedModelId(draft.id)
    setModelDraft(draft)
    setModelProviderId('')
  }

  const handleSaveModel = async () => {
    if (!modelDraft) return
    const sanitized = sanitizeDraftModel(modelDraft)
    const validationMessage = getModelDraftValidationMessage(sanitized)
    if (validationMessage || !modelProviderId) {
      setModelDraft({
        ...sanitized,
        testStatus: 'error',
        testMessage: validationMessage || '请选择同类型的本地服务商。',
      })
      return
    }

    setBusyAction('save-model')
    try {
      saveCustomModel(sanitized)
      setModelProviderProfile(sanitized.modelId, modelProviderId)
      await persistLocalVault()
      setSelectedModelId(sanitized.id)
      setModelDraft(sanitized)
      notify({ title: '模型已保存到本地 Vault', tone: 'success' })
    } catch {
      notify({ title: '模型保存失败', tone: 'error' })
    } finally {
      setBusyAction(null)
    }
  }

  const handleDeleteModel = async () => {
    if (!modelDraft || modelDraft.id.startsWith('draft-model-')) {
      setModelDraft(null)
      setSelectedModelId(null)
      return
    }
    deleteCustomModel(modelDraft.id)
    await persistLocalVault().catch(() => undefined)
    setModelDraft(null)
    setSelectedModelId(null)
    setModelProviderId('')
  }

  const listItems = view === 'providers' ? providersForKind : modelsForKind

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3">
        <div className="grid grid-cols-2 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-1">
          <button
            type="button"
            onClick={() => setView('providers')}
            aria-pressed={view === 'providers'}
            className={cx('flex h-8 items-center gap-2 rounded-[6px] px-3 text-xs font-medium', view === 'providers' ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}
          >
            <Server className="h-3.5 w-3.5" />
            服务商
          </button>
          <button
            type="button"
            onClick={() => setView('models')}
            aria-pressed={view === 'models'}
            className={cx('flex h-8 items-center gap-2 rounded-[6px] px-3 text-xs font-medium', view === 'models' ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}
          >
            <Boxes className="h-3.5 w-3.5" />
            模型
          </button>
        </div>

        <div className="flex max-w-full gap-1 overflow-x-auto rounded-[8px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-1">
          {MODEL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveKind(tab.id)
                setSelectedProviderId(null)
                setProviderDraft(null)
                setSelectedModelId(null)
                setModelDraft(null)
              }}
              aria-pressed={activeKind === tab.id}
              className={cx('h-7 shrink-0 rounded-[6px] px-2.5 text-[11px] font-medium', activeKind === tab.id ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-[var(--border-subtle)] md:border-b-0 md:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {listItems.length ? (
              <div className="space-y-1">
                {listItems.map((item) => {
                  const active = view === 'providers' ? selectedProviderId === item.id : selectedModelId === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => view === 'providers' ? selectProvider(item.id) : selectModel(item.id)}
                      aria-pressed={active}
                      className={cx(
                        'w-full rounded-[7px] border px-3 py-2 text-left text-xs transition',
                        active
                          ? 'border-[var(--border-subtle)] bg-[var(--control-bg-hover)] text-[var(--text-primary)]'
                          : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--control-bg)]',
                      )}
                    >
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className={`mt-0.5 block truncate text-[10px] ${themeClasses.textMuted}`}>
                        {'provider' in item ? getProviderDefinition(item.provider).label : item.modelId}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className={`flex min-h-24 items-center justify-center px-4 text-center text-xs ${themeClasses.textMuted}`}>
                当前 {getKindLabel(activeKind)} 分类为空
              </div>
            )}
          </div>
          <div className="border-t border-[var(--border-subtle)] p-2">
            <button
              type="button"
              onClick={view === 'providers' ? handleAddProvider : handleAddModel}
              className={`${themeClasses.secondaryButton} h-8 w-full gap-1.5 rounded-[7px] text-xs`}
            >
              <Plus className="h-3.5 w-3.5" />
              {view === 'providers' ? '添加服务商' : '添加模型'}
            </button>
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto px-5 py-4">
          {view === 'providers' && providerDraft ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>显示名称</span>
                  <input className={FIELD_INPUT_CLASS} value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} />
                </label>
                <label className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>服务商协议</span>
                  <select
                    className={FIELD_SELECT_CLASS}
                    value={providerDraft.provider}
                    onChange={(event) => {
                      const provider = event.target.value as DraftProviderProfile['provider']
                      setProviderDraft({
                        ...providerDraft,
                        provider,
                        apiUrl: providerDraft.apiUrl || getProviderDefinition(provider).defaultApiUrl,
                      })
                    }}
                  >
                    {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>分类</span>
                  <select className={FIELD_SELECT_CLASS} value={providerDraft.kind} onChange={(event) => {
                    const kind = event.target.value as CustomModelKind
                    setProviderDraft({ ...providerDraft, kind })
                    setActiveKind(kind)
                  }}>
                    {MODEL_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>请求模式</span>
                  <select className={FIELD_SELECT_CLASS} value={providerDraft.requestMode} onChange={(event) => setProviderDraft({ ...providerDraft, requestMode: event.target.value as DraftProviderProfile['requestMode'] })}>
                    <option value="sync">同步</option>
                    <option value="async">异步轮询</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                <span className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />Endpoint</span>
                <input
                  type="url"
                  name="provider-endpoint"
                  className={FIELD_INPUT_CLASS}
                  value={providerDraft.apiUrl}
                  onChange={(event) => setProviderDraft({ ...providerDraft, apiUrl: event.target.value })}
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-form-type="other"
                  data-lpignore="true"
                  spellCheck={false}
                />
              </label>

              <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                <span className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />API Key</span>
                <span className="relative block">
                  <input
                    type="text"
                    name="provider-api-key"
                    className={cx(FIELD_INPUT_CLASS, 'pr-10', !showApiKey && '[-webkit-text-security:disc]')}
                    value={providerDraft.apiKey}
                    onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-form-type="other"
                    data-lpignore="true"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((current) => !current)}
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[var(--text-muted)]"
                    aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                  >
                    {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input type="checkbox" checked={providerDraft.enabled} onChange={(event) => setProviderDraft({ ...providerDraft, enabled: event.target.checked })} />
                启用此服务商
              </label>

              {providerDraft.testMessage ? (
                <div className={cx('text-xs', providerDraft.testStatus === 'error' ? 'text-red-500 dark:text-red-300' : providerDraft.testStatus === 'success' ? 'text-emerald-600 dark:text-emerald-300' : themeClasses.textMuted)}>
                  {providerDraft.testMessage}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-4">
                <button type="button" onClick={() => void handleDeleteProvider()} className={`${themeClasses.iconButton} h-8 w-8 rounded-[7px]`} aria-label="删除服务商"><Trash2 className="h-3.5 w-3.5" /></button>
                <div className="flex flex-wrap gap-2">
                  {!providerDraft.id.startsWith('draft-provider-') ? (
                    <button type="button" onClick={() => { setActiveProviderProfile(providerDraft.kind, providerDraft.id); void persistLocalVault() }} className={`${themeClasses.secondaryButton} h-8 rounded-[7px] px-3 text-xs`}>
                      <Check className="h-3.5 w-3.5" />设为当前
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void handleTestProvider()} disabled={busyAction !== null} className={`${themeClasses.secondaryButton} h-8 rounded-[7px] px-3 text-xs disabled:opacity-50`}>测试连接</button>
                  <button type="button" onClick={() => void handleSaveProvider()} disabled={busyAction !== null} className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)] disabled:opacity-50">保存</button>
                </div>
              </div>
            </div>
          ) : null}

          {view === 'models' && modelDraft ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>显示名称</span>
                  <input className={FIELD_INPUT_CLASS} value={modelDraft.name} onChange={(event) => setModelDraft({ ...modelDraft, name: event.target.value })} />
                </label>
                <label className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>分类</span>
                  <select className={FIELD_SELECT_CLASS} value={modelDraft.kind} onChange={(event) => {
                    const kind = event.target.value as CustomModelKind
                    setModelDraft({ ...modelDraft, kind })
                    setModelProviderId('')
                    setActiveKind(kind)
                  }}>
                    {MODEL_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                <span>模型 ID</span>
                <input className={FIELD_INPUT_CLASS} value={modelDraft.modelId} onChange={(event) => setModelDraft({ ...modelDraft, modelId: event.target.value })} autoComplete="off" spellCheck={false} />
              </label>
              <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                <span>服务商绑定</span>
                <select className={FIELD_SELECT_CLASS} value={modelProviderId} onChange={(event) => setModelProviderId(event.target.value)}>
                  <option value="">请选择同类型服务商</option>
                  {config.providerProfiles.filter((profile) => profile.kind === modelDraft.kind).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input type="checkbox" checked={modelDraft.enabled} onChange={(event) => setModelDraft({ ...modelDraft, enabled: event.target.checked })} />
                启用此模型
              </label>
              {modelDraft.testMessage ? <div className="text-xs text-red-500 dark:text-red-300">{modelDraft.testMessage}</div> : null}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-4">
                <button type="button" onClick={() => void handleDeleteModel()} className={`${themeClasses.iconButton} h-8 w-8 rounded-[7px]`} aria-label="删除模型"><Trash2 className="h-3.5 w-3.5" /></button>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setDefaultModel(modelDraft.modelId); void persistLocalVault() }} disabled={modelDraft.id.startsWith('draft-model-') || !modelDraft.modelId.trim() || modelDraft.kind !== 'image'} className={`${themeClasses.secondaryButton} h-8 rounded-[7px] px-3 text-xs disabled:opacity-50`}>设为默认</button>
                  <button type="button" onClick={() => void handleSaveModel()} disabled={busyAction !== null} className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)] disabled:opacity-50">保存</button>
                </div>
              </div>
            </div>
          ) : null}

          {((view === 'providers' && !providerDraft) || (view === 'models' && !modelDraft)) ? (
            <div className={`flex h-full min-h-40 items-center justify-center text-center text-xs ${themeClasses.textMuted}`}>
              使用左侧按钮添加{view === 'providers' ? '服务商' : '模型'}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
