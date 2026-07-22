import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  LogOut,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  getModelDeleteErrorFeedback,
  getModelDeleteSuccessFeedback,
  getModelSaveErrorFeedback,
  getModelSaveSuccessFeedback,
} from '@/features/settings/modelFeedback'
import {
  getModelDraftValidationMessage,
  PROVIDER_CONFIG_MESSAGES,
} from '@/features/settings/providerConfig'
import { isClaudeModel } from '@/features/settings/modelBrand'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { useAuthStore } from '@/features/auth/useAuthStore'
import { useFeedbackStore } from '@/store/useFeedbackStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useSettingsDialogStore } from '@/store/useSettingsDialogStore'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { StorageSettingsPanel } from '@/components/StorageSettingsDialog'
import { AccountSettingsPanel } from '@/features/auth/AccountMenu'
import { DeviceSettingsPanel } from '@/features/auth/DeviceSettingsPanel'
import { TaskQueueButton } from '@/components/TaskQueueButton'
import { themeClasses } from '@/styles/themeClasses'
import type { CanvasPerformanceMode, CustomModelKind, EdgeStyle, ThemeMode } from '@/types'
import {
  AUTOSAVE_INTERVAL_OPTIONS,
  CANVAS_EXPERIENCE_TEXT,
  CANVAS_OPTION_BUTTON_CLASS,
  CANVAS_OPTION_GROUP_CLASS,
  CANVAS_PERFORMANCE_OPTIONS,
  CANVAS_SETTINGS_ROW_CLASS,
  type DraftModelCard,
  EDGE_STYLE_OPTIONS,
  FIELD_INPUT_CLASS,
  FIELD_SELECT_CLASS,
  MODEL_NAME_LABEL,
  MODEL_SETTINGS_PANEL_CLASS,
  MODEL_TAB_ICONS,
  MODEL_TABS,
  SETTINGS_CATEGORIES,
  THEME_MODE_OPTIONS,
  UI_TEXT,
  createEmptyDraft,
  cx,
  getKindLabel,
  getStatusTone,
  sanitizeDraftModel,
  toDraftModel,
} from '@/components/toolbar/settingsModel'
import { CanvasSettingsSwitch, DetailRow } from '@/components/toolbar/settingsComponents'

interface ToolbarProps {
  leftSlot?: ReactNode
  rightSlot?: ReactNode
}

export function Toolbar({ leftSlot, rightSlot }: ToolbarProps) {
  const {
    config,
    saveCustomModel,
    deleteCustomModel,
    setModelProviderProfile,
    setDefaultModel,
    setStorageSettings,
    persistWorkspaceConfig,
  } = useSettingsStore(useShallow((state) => ({
    config: state.config,
    saveCustomModel: state.saveCustomModel,
    deleteCustomModel: state.deleteCustomModel,
    setModelProviderProfile: state.setModelProviderProfile,
    setDefaultModel: state.setDefaultModel,
    setStorageSettings: state.setStorageSettings,
    persistWorkspaceConfig: state.persistWorkspaceConfig,
  })))
  const notify = useFeedbackStore((state) => state.notify)
  const logout = useAuthStore((state) => state.logout)
  const showSettings = useSettingsDialogStore((state) => state.isOpen)
  const activeCategory = useSettingsDialogStore((state) => state.activeCategory)
  const closeSettings = useSettingsDialogStore((state) => state.close)
  const setActiveCategory = useSettingsDialogStore((state) => state.setActiveCategory)
  const [draftModels, setDraftModels] = useState<DraftModelCard[]>([])
  const [draftModelProviderProfileIds, setDraftModelProviderProfileIds] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<CustomModelKind>('image')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const savedModels = config.customModels
  const localProviderProfiles = config.providerProfiles

  const visibleDraftModels = draftModels.filter((model) => {
    if (model.kind !== activeTab) {
      return false
    }

    if (!searchQuery.trim()) {
      return true
    }

    const keyword = searchQuery.trim().toLowerCase()
    return (
      model.modelId.toLowerCase().includes(keyword) ||
      model.name.toLowerCase().includes(keyword) ||
      model.kind.toLowerCase().includes(keyword)
    )
  })

  useEffect(() => {
    if (!showSettings) {
      return
    }

    setDraftModels(savedModels.map(toDraftModel))
    setDraftModelProviderProfileIds(config.modelProviderProfileIds)
    setSearchQuery('')
  }, [config.modelProviderProfileIds, savedModels, showSettings])

  useEffect(() => {
    if (!showSettings || activeCategory !== 'models') {
      return
    }

    if (visibleDraftModels.length === 0) {
      setSelectedModelId(null)
      return
    }

    const stillVisible = visibleDraftModels.some((model) => model.id === selectedModelId)
    if (!stillVisible) {
      setSelectedModelId(visibleDraftModels[0].id)
    }
  }, [activeCategory, showSettings, visibleDraftModels, selectedModelId])

  const selectedModel = draftModels.find((model) => model.id === selectedModelId) ?? null
  const selectedProviderId = selectedModel ? draftModelProviderProfileIds[selectedModel.modelId] ?? '' : ''
  const selectedProvider = localProviderProfiles.find((provider) => provider.id === selectedProviderId) ?? null

  const closeSettingsPanel = () => {
    closeSettings()
    setDraftModels([])
    setDraftModelProviderProfileIds({})
    setSelectedModelId(null)
    setSearchQuery('')
  }

  const settingsDialogRef = useDialogFocus<HTMLDivElement>(showSettings, closeSettingsPanel)

  const updateDraft = (id: string, patch: Partial<DraftModelCard>) => {
    setDraftModels((current) =>
      current.map((model) =>
        model.id === id
          ? {
            ...model,
            ...patch,
          }
          : model,
      ),
    )

    if (patch.kind) {
      setActiveTab(patch.kind)
    }
  }

  const updateSelectedModelProvider = (model: DraftModelCard, profileId: string | null) => {
    setDraftModelProviderProfileIds((current) => {
      const next = { ...current }
      if (profileId) {
        next[model.modelId] = profileId
      } else {
        delete next[model.modelId]
      }
      return next
    })
  }

  const updateSelectedModelId = (model: DraftModelCard, modelId: string) => {
    const nextModelId = modelId.trim()
    updateDraft(model.id, { modelId })
    setDraftModelProviderProfileIds((current) => {
      const existingProfileId = current[model.modelId]
      if (!existingProfileId || !nextModelId || nextModelId === model.modelId) {
        return current
      }

      const next = { ...current }
      delete next[model.modelId]
      next[nextModelId] = existingProfileId
      return next
    })
  }

  const handleAddModel = () => {
    const nextModel = createEmptyDraft(activeTab)
    setDraftModels((current) => [...current, nextModel])
    setSelectedModelId(nextModel.id)
    setSearchQuery('')
  }

  const handleDeleteModel = async (id: string) => {
    const deletedModel = draftModels.find((model) => model.id === id)
    const deletedModelName = deletedModel?.name || deletedModel?.modelId || ''
    let nextSelectedId: string | null = null

    setDraftModels((current) => {
      const filtered = current.filter((model) => model.id !== id)
      const nextVisible = filtered.filter((model) => model.kind === activeTab)
      nextSelectedId = nextVisible[0]?.id ?? null
      return filtered
    })

    setSelectedModelId((current) => (current === id ? nextSelectedId : current))
    deleteCustomModel(id)
    try {
      await persistWorkspaceConfig()
      notify(getModelDeleteSuccessFeedback(deletedModelName))
    } catch {
      notify(getModelDeleteErrorFeedback(deletedModelName))
    }
  }

  const handleSaveModel = async (model: DraftModelCard, providerId: string | null) => {
    const sanitized = sanitizeDraftModel(model)
    const validationMessage = getModelDraftValidationMessage(sanitized)
    const providerValidationMessage = providerId ? '' : PROVIDER_CONFIG_MESSAGES.emptyProviderProfile

    if (validationMessage || providerValidationMessage) {
      updateDraft(model.id, {
        testStatus: 'error',
        testMessage: validationMessage || providerValidationMessage,
      })
      return
    }

    if (!providerId) {
      return
    }

    saveCustomModel(sanitized)
    setModelProviderProfile(sanitized.modelId, providerId)
    updateDraft(model.id, sanitized)
    setDraftModelProviderProfileIds((current) => ({
      ...current,
      [sanitized.modelId]: providerId,
    }))
    try {
      await useSettingsStore.getState().persistWorkspaceConfig()
      notify(getModelSaveSuccessFeedback(sanitized.name || sanitized.modelId))
    } catch {
      notify(getModelSaveErrorFeedback(sanitized.name || sanitized.modelId))
    }
  }

  const handleToggleAlignmentGuides = async () => {
    setStorageSettings({ alignmentGuidesEnabled: !config.storage.alignmentGuidesEnabled })
    await persistWorkspaceConfig().catch(() => undefined)
  }

  const handleToggleCanvasGrid = async () => {
    setStorageSettings({ canvasGridEnabled: !config.storage.canvasGridEnabled })
    await persistWorkspaceConfig().catch(() => undefined)
  }

  const handleCanvasPerformanceModeChange = async (canvasPerformanceMode: CanvasPerformanceMode) => {
    setStorageSettings({ canvasPerformanceMode })
    await persistWorkspaceConfig().catch(() => undefined)
  }

  const handleEdgeStyleChange = async (edgeStyle: EdgeStyle) => {
    setStorageSettings({ edgeStyle })
    await persistWorkspaceConfig().catch(() => undefined)
  }

  const handleToggleHighQualityPreview = async () => {
    setStorageSettings({ lowQualityPreviewEnabled: !config.storage.lowQualityPreviewEnabled })
    await persistWorkspaceConfig().catch(() => undefined)
  }

  const handleThemeModeChange = async (themeMode: ThemeMode) => {
    setStorageSettings({ themeMode })
    await persistWorkspaceConfig().catch(() => undefined)
  }

  return (
    <>
      {leftSlot ? (
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
          {leftSlot}
        </div>
      ) : null}

      <div role="toolbar" aria-label="应用工具" className={`absolute right-4 top-4 z-10 flex items-center gap-0.5 p-1 ${themeClasses.compactFloatingPanel}`}>
        <TaskQueueButton />
        {rightSlot}
      </div>

      {showSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/30 px-4 py-6 backdrop-blur-sm">
          <div ref={settingsDialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" tabIndex={-1} className={`grid h-[min(84vh,44rem)] w-[min(94vw,76rem)] overflow-hidden rounded-[16px] md:grid-cols-[13rem_minmax(0,1fr)] ${themeClasses.strongPanel}`}>
            <aside className="flex min-h-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--control-bg)]">
              <div className="border-b border-[var(--border-subtle)] px-4 pb-4 pt-4">
                <h2 id="settings-dialog-title" className={`text-[15px] font-semibold ${themeClasses.textPrimary}`}>{UI_TEXT.settingsTitle}</h2>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
                <div className="space-y-1">
                  {SETTINGS_CATEGORIES.map((category) => {
                    const active = activeCategory === category.id
                    const CategoryIcon = category.Icon

                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveCategory(category.id)}
                        data-testid={`settings-category-${category.id}`}
                        aria-label={category.label}
                        aria-pressed={active}
                        className={cx(
                          'settings-nav-item group relative w-full overflow-hidden rounded-[10px] border px-3 py-2.5 text-left transition-all duration-200 ease-out',
                          active
                            ? 'is-active border-violet-400/30 bg-violet-400/10 text-[var(--text-primary)] shadow-[0_8px_24px_rgba(139,92,246,0.08)]'
                            : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]',
                        )}
                      >
                        <span className="flex items-center gap-2 text-[13px] font-medium">
                          <span className={cx('transition-colors duration-200', active ? 'text-violet-300' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]')}>
                            <CategoryIcon className="h-3.5 w-3.5" />
                          </span>
                          {category.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="shrink-0 border-t border-[var(--border-subtle)] p-2">
                <button
                  type="button"
                  data-testid="settings-logout-button"
                  onClick={() => {
                    closeSettingsPanel()
                    void logout()
                  }}
                  className="group flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:bg-red-500/8 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400/50 dark:hover:text-red-300"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-red-500 dark:group-hover:text-red-300" />
                  <span>退出登录</span>
                </button>
              </div>
            </aside>

            <main className="min-h-0 bg-[var(--panel-bg-strong)]">
              {activeCategory === 'models' ? (
                <section key="models" className="settings-content-enter flex h-full min-h-0 flex-col">
                  <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
                    <div className="min-w-0">
                      <h2 className={`text-[17px] font-semibold ${themeClasses.textPrimary}`}>
                        {SETTINGS_CATEGORIES.find((category) => category.id === activeCategory)?.label}
                      </h2>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={closeSettingsPanel}
                        aria-label={UI_TEXT.close}
                        className={`${themeClasses.iconButton} h-8 w-8 shrink-0 rounded-[9px]`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </header>

                  <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-5 md:grid-cols-[16rem_minmax(0,1fr)] md:overflow-hidden">
                    <section className={`${MODEL_SETTINGS_PANEL_CLASS} flex min-h-0 flex-col`}>
                      <div className="border-b border-[var(--border-subtle)] px-4 pb-3 pt-4">
                        <h2 className={`text-sm font-semibold ${themeClasses.textPrimary}`}>{UI_TEXT.modelLibrary}</h2>
                        <p className={`mt-1 text-[11px] ${themeClasses.textMuted}`}>
                          {visibleDraftModels.length} {UI_TEXT.itemUnit} {getKindLabel(activeTab)}
                        </p>

                        <div className="mt-3 grid grid-cols-5 gap-1 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-1">
                          {MODEL_TABS.map((tab) => {
                            const isActive = activeTab === tab.id
                            const TabIcon = MODEL_TAB_ICONS[tab.id]

                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={cx(
                                  'inline-flex h-7 items-center justify-center rounded-[7px] text-[11px] font-medium transition-all duration-200 ease-out',
                                  isActive
                                    ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_var(--border-subtle)]'
                                    : 'text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]',
                                )}
                                title={tab.label}
                              >
                                <TabIcon className="h-3.5 w-3.5" />
                              </button>
                            )
                          })}
                        </div>

                        <div className="relative mt-3">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={UI_TEXT.search}
                            aria-label={UI_TEXT.search}
                            className={`${FIELD_INPUT_CLASS} pl-8 pr-3`}
                          />
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-subtle)] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
                        <div key={`${activeTab}-${searchQuery.trim() ? 'search' : 'all'}`} className="space-y-1">
                          {visibleDraftModels.length === 0 ? (
                            <div className={`flex h-full min-h-32 items-center justify-center rounded-[12px] border border-dashed border-[var(--border-subtle)] bg-[var(--control-bg)] px-4 text-center text-xs leading-5 ${themeClasses.textMuted}`}>
                              {searchQuery.trim() ? UI_TEXT.emptySearch : UI_TEXT.emptyTab}
                            </div>
                          ) : (
                            visibleDraftModels.map((model) => {
                              const isActive = model.id === selectedModelId
                              const showClaudeIcon = isClaudeModel(model)
                              return (
                                <button
                                  key={model.id}
                                  type="button"
                                  onClick={() => setSelectedModelId(model.id)}
                                  aria-pressed={isActive}
                                  className={cx(
                                    'w-full rounded-[9px] border px-3 py-2.5 text-left transition-all duration-200 ease-out',
                                    isActive
                                      ? 'border-[var(--border-subtle)] bg-[var(--control-bg-hover)]'
                                      : 'border-transparent bg-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--control-bg-hover)]',
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      {showClaudeIcon ? <ClaudeIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                                      <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                                        {model.name || model.modelId || 'New Model'}
                                      </div>
                                    </div>

                                    <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', getStatusTone(model.testStatus, isActive))} />
                                  </div>
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>

                      <div className="border-t border-[var(--border-subtle)] p-3">
                        <button
                          type="button"
                          onClick={handleAddModel}
                          className={`${themeClasses.secondaryButton} h-8 w-full gap-1.5 rounded-[9px] text-xs font-medium`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {UI_TEXT.addModel}
                        </button>
                      </div>
                    </section>

                    {selectedModel ? (
                      <section key={selectedModel.id} className={`${MODEL_SETTINGS_PANEL_CLASS} settings-content-enter flex min-h-0 flex-col`}>
                        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3">
                          <div className="min-w-0">
                            <h2 className={`mt-1 flex min-w-0 items-center gap-2 text-[17px] font-semibold ${themeClasses.textPrimary}`}>
                              {isClaudeModel(selectedModel) ? <ClaudeIcon className="h-4 w-4 shrink-0" /> : null}
                              {selectedModel.name || selectedModel.modelId || UI_TEXT.modelDetails}
                            </h2>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              void handleDeleteModel(selectedModel.id)
                            }}
                            className={`${themeClasses.iconButton} h-8 w-8 shrink-0 rounded-[9px]`}
                            aria-label={UI_TEXT.delete}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex min-h-0 flex-1 overflow-y-auto px-5 py-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-subtle)] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
                    <div key={`${activeTab}-${selectedModel.id}-${selectedProvider?.id ?? 'no-provider'}`} className="mx-auto grid w-full max-w-4xl self-start overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
                        <DetailRow label={MODEL_NAME_LABEL} hint="给模型起一个更容易识别的名字。">
                          <input
                            type="text"
                            value={selectedModel.name}
                            onChange={(event) => updateDraft(selectedModel.id, { name: event.target.value })}
                            placeholder="Flux Pro / 豆包绘图"
                            aria-label={MODEL_NAME_LABEL}
                            className={FIELD_INPUT_CLASS}
                          />
                        </DetailRow>

                        <DetailRow label={UI_TEXT.modelKind} hint="决定它出现在哪个模型分类里。">
                          <div className="grid h-8.5 grid-cols-5 gap-1 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-1">
                            {MODEL_TABS.map((tab) => (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => updateDraft(selectedModel.id, { kind: tab.id })}
                                aria-pressed={selectedModel.kind === tab.id}
                                className={cx(
                                  'inline-flex items-center justify-center rounded-[7px] text-[11px] font-medium transition',
                                  selectedModel.kind === tab.id
                                    ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                                )}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                        </DetailRow>

                        <DetailRow label={UI_TEXT.modelId} hint="服务商实际识别的模型 ID。">
                          <input
                            type="text"
                            value={selectedModel.modelId}
                            onChange={(event) => updateSelectedModelId(selectedModel, event.target.value)}
                            placeholder="new-model-id"
                            aria-label={UI_TEXT.modelId}
                            className={FIELD_INPUT_CLASS}
                          />
                        </DetailRow>
                        <DetailRow label="服务商" hint="模型绑定当前设备中的本地服务商配置。">
                          <select
                            value={selectedProviderId}
                            onChange={(event) => updateSelectedModelProvider(selectedModel, event.target.value || null)}
                            className={FIELD_SELECT_CLASS}
                            aria-label="服务商"
                          >
                            <option value="">请选择本地服务商</option>
                            {localProviderProfiles.map((provider) => (
                              <option key={provider.id} value={provider.id} className="bg-[var(--panel-bg-strong)] text-[var(--text-primary)]">
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </DetailRow>
                    </div>
                  </div>

                  <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--control-bg)] px-5 py-3">
                    <div
                      className={cx(
                        'min-h-5 text-xs',
                        selectedModel.testStatus === 'success'
                          ? themeClasses.textPrimary
                          : selectedModel.testStatus === 'error'
                            ? 'text-red-600 dark:text-red-200'
                            : themeClasses.textMuted,
                      )}
                    >
                      {selectedModel.testMessage ||
                        (savedModels.some((item) => item.id === selectedModel.id) ? UI_TEXT.saved : UI_TEXT.unsaved)}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDefaultModel(selectedModel.modelId)
                          void persistWorkspaceConfig().catch(() => undefined)
                        }}
                        disabled={!selectedModel.modelId.trim() || selectedModel.kind !== 'image'}
                        className={`${themeClasses.secondaryButton} h-8 rounded-[9px] px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {UI_TEXT.setDefault}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void handleSaveModel(selectedModel, selectedProvider?.id ?? null)
                        }}
                        className="h-8 rounded-[9px] bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)] transition hover:opacity-90"
                      >
                        {UI_TEXT.save}
                      </button>
                    </div>
                  </footer>
                  </section>
                ) : (
                  <section className={`${MODEL_SETTINGS_PANEL_CLASS} flex h-full items-center justify-center px-6`}>
                    <div className={`rounded-[12px] border border-dashed border-[var(--border-subtle)] bg-[var(--control-bg)] px-8 py-10 text-center text-sm ${themeClasses.textMuted}`}>
                      {UI_TEXT.emptySelection}
                    </div>
                  </section>
                )}
                </div>
                </section>
              ) : (
                <section key={activeCategory} className="settings-content-enter flex h-full min-h-0 flex-col">
                  <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
                    <div className="min-w-0">
                      <h2 className={`text-[17px] font-semibold ${themeClasses.textPrimary}`}>
                        {SETTINGS_CATEGORIES.find((category) => category.id === activeCategory)?.label}
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={closeSettingsPanel}
                      aria-label={UI_TEXT.close}
                      className={`${themeClasses.iconButton} h-8 w-8 shrink-0 rounded-[9px]`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </header>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-subtle)] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
                    {activeCategory === 'account' ? <AccountSettingsPanel onSignedOut={closeSettingsPanel} /> : null}
                    {activeCategory === 'devices' ? <DeviceSettingsPanel /> : null}
                    {activeCategory === 'storage' ? <StorageSettingsPanel active={showSettings && activeCategory === 'storage'} /> : null}
                    {activeCategory === 'canvas' ? (
                      <section className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{CANVAS_EXPERIENCE_TEXT.performanceMode}</div>
                            <p className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}>{CANVAS_EXPERIENCE_TEXT.performanceModeHint}</p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {CANVAS_PERFORMANCE_OPTIONS.map((option) => {
                              const active = config.storage.canvasPerformanceMode === option.id

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    void handleCanvasPerformanceModeChange(option.id)
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]'
                                      : 'text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]',
                                  )}
                                  aria-pressed={active}
                                >
                                  <span className="block truncate">{option.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{CANVAS_EXPERIENCE_TEXT.lowQualityPreview}</div>
                            <p className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}>{CANVAS_EXPERIENCE_TEXT.lowQualityPreviewHint}</p>
                          </div>
                          <CanvasSettingsSwitch
                            checked={config.storage.lowQualityPreviewEnabled}
                            label="启用高清图片预览"
                            onChange={() => {
                              void handleToggleHighQualityPreview()
                            }}
                          />
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{CANVAS_EXPERIENCE_TEXT.alignmentGuides}</div>
                            <p className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}>{CANVAS_EXPERIENCE_TEXT.alignmentGuidesHint}</p>
                          </div>
                          <CanvasSettingsSwitch
                            checked={config.storage.alignmentGuidesEnabled}
                            label="启用对齐参考线"
                            onChange={() => {
                              void handleToggleAlignmentGuides()
                            }}
                          />
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>画布自动保存时间</div>
                            <p className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}>自动保存会直接写入当前项目文件，但不会替代手动保存。</p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {AUTOSAVE_INTERVAL_OPTIONS.map((option) => {
                              const active = option.value === config.storage.autosaveIntervalMs

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => {
                                    setStorageSettings({ autosaveIntervalMs: option.value })
                                    void persistWorkspaceConfig().catch(() => undefined)
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]'
                                      : 'text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]',
                                  )}
                                  aria-pressed={active}
                                >
                                  {option.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                      </section>
                    ) : null}
                    {activeCategory === 'appearance' ? (
                      <section className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{CANVAS_EXPERIENCE_TEXT.appearanceTheme}</div>
                            <p className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}>{CANVAS_EXPERIENCE_TEXT.appearanceThemeHint}</p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {THEME_MODE_OPTIONS.map((option) => {
                              const active = config.storage.themeMode === option.id

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    void handleThemeModeChange(option.id)
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]'
                                      : 'text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]',
                                  )}
                                  aria-pressed={active}
                                >
                                  {option.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{CANVAS_EXPERIENCE_TEXT.canvasGrid}</div>
                            <p className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}>{CANVAS_EXPERIENCE_TEXT.canvasGridHint}</p>
                          </div>
                          <CanvasSettingsSwitch
                            checked={config.storage.canvasGridEnabled}
                            label="显示画布网格"
                            onChange={() => {
                              void handleToggleCanvasGrid()
                            }}
                          />
                        </div>

                        <div className={CANVAS_SETTINGS_ROW_CLASS}>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${themeClasses.textPrimary}`}>{CANVAS_EXPERIENCE_TEXT.edgeStyle}</div>
                            <p className={`mt-1 max-w-2xl truncate text-xs ${themeClasses.textMuted}`}>{CANVAS_EXPERIENCE_TEXT.edgeStyleHint}</p>
                          </div>
                          <div className={CANVAS_OPTION_GROUP_CLASS}>
                            {EDGE_STYLE_OPTIONS.map((option) => {
                              const active = config.storage.edgeStyle === option.id

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    void handleEdgeStyleChange(option.id)
                                  }}
                                  className={cx(
                                    CANVAS_OPTION_BUTTON_CLASS,
                                    active
                                      ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]'
                                      : 'text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]',
                                  )}
                                  aria-pressed={active}
                                >
                                  <span className="block truncate">{option.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </section>
                    ) : null}
                    {activeCategory === 'tasks' ? (
                      <div className="rounded-[18px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-5">
                        <div className={`text-sm font-medium ${themeClasses.textPrimary}`}>任务队列设置预留</div>
                        <p className={`mt-2 text-xs leading-5 ${themeClasses.textMuted}`}>当前任务队列会自动恢复排队和远程轮询任务。后续可在这里加入并发、失败重试和完成任务清理策略。</p>
                      </div>
                    ) : null}
                  </div>
                </section>
              )}
            </main>
          </div>
        </div>
      )}

    </>
  )
}
