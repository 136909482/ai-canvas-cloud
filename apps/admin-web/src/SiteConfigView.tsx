import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useCan } from '@refinedev/core'
import type { SiteAssetKind, SiteAssetSummary, SiteConfigDocument } from '@ai-canvas-cloud/contracts'
import { DEFAULT_SITE_CONFIG } from '@ai-canvas-cloud/contracts'
import {
  Check,
  FileText,
  Globe2,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Save,
  Settings2,
  Upload,
  X,
} from 'lucide-react'
import { adminApi, AdminApiError } from './api'

function errorMessage(error: unknown) {
  return error instanceof AdminApiError ? error.message : '网站设置请求未完成'
}

function InputField({ label, value, onChange, placeholder, maxLength = 120 }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
}) {
  return <label className="site-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} /></label>
}

function NullableField({ label, value, onChange, placeholder }: {
  label: string
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
}) {
  return <InputField label={label} value={value ?? ''} onChange={(next) => onChange(next || null)} placeholder={placeholder} maxLength={2048} />
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="site-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>
}

function AssetSelector({ kind, label, assets, selectedId, busy, onSelect, onUpload }: {
  kind: SiteAssetKind
  label: string
  assets: SiteAssetSummary[]
  selectedId: string | null
  busy: boolean
  onSelect: (id: string | null) => void
  onUpload: (kind: SiteAssetKind, file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const candidates = assets.filter((asset) => asset.kind === kind && asset.status === 'completed')
  const selected = candidates.find((asset) => asset.id === selectedId) ?? null
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onUpload(kind, file)
    event.target.value = ''
  }
  return (
    <div className="asset-selector">
      <div className="asset-preview">
        {selected?.url ? <img src={selected.url} alt="" /> : <ImageIcon />}
      </div>
      <div className="asset-selector__body">
        <strong>{label}</strong>
        <span>{selected ? `${selected.width} × ${selected.height} · ${selected.mimeType}` : '使用内置品牌资产'}</span>
        <div className="asset-actions">
          <button type="button" className="secondary-command" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <LoaderCircle className="spin" /> : <Upload />}上传
          </button>
          {selected ? <button type="button" className="icon-command" title="恢复内置资产" onClick={() => onSelect(null)}><X /></button> : null}
        </div>
        {candidates.length > 1 ? (
          <select value={selectedId ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
            <option value="">内置资产</option>
            {candidates.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFileName}</option>)}
          </select>
        ) : null}
      </div>
      <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/x-icon,.ico" onChange={pick} />
    </div>
  )
}

export function SiteConfigView() {
  const { data: access, isLoading: accessLoading } = useCan({ resource: 'site-config', action: 'site_config.write' })
  const [config, setConfig] = useState<SiteConfigDocument>(() => structuredClone(DEFAULT_SITE_CONFIG))
  const [assets, setAssets] = useState<SiteAssetSummary[]>([])
  const [note, setNote] = useState('')
  const [revision, setRevision] = useState<{ id: string; createdAt: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<SiteAssetKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (accessLoading || !access?.can) { setLoading(false); return }
    let active = true
    Promise.all([adminApi.siteConfig(), adminApi.siteAssets()]).then(([site, assetPage]) => {
      if (!active) return
      setConfig(structuredClone(site.config))
      setRevision(site.revision ? { id: site.revision.id, createdAt: site.revision.createdAt } : null)
      setAssets(assetPage.items)
    }).catch((cause) => { if (active) setError(errorMessage(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [access?.can, accessLoading])

  const recordCount = useMemo(() => Object.values(config.records).filter(Boolean).length, [config.records])

  async function upload(kind: SiteAssetKind, file: File) {
    setUploading(kind); setError(null)
    try {
      const result = await adminApi.uploadSiteAsset(kind, file)
      setAssets((current) => [result.asset, ...current.filter((asset) => asset.id !== result.asset.id)])
      setConfig((current) => ({ ...current, [kind === 'logo' ? 'logoAssetId' : 'faviconAssetId']: result.asset.id }))
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setUploading(null) }
  }

  async function save() {
    setSaving(true); setSaved(false); setError(null)
    try {
      const result = await adminApi.publishSiteConfig({ config, note: note || null })
      setConfig(structuredClone(result.config))
      setRevision(result.revision ? { id: result.revision.id, createdAt: result.revision.createdAt } : null)
      setNote(''); setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="empty-state"><LoaderCircle className="spin" />正在读取网站设置</div>
  if (!access?.can) return <div className="empty-state">当前角色无权管理网站设置。</div>

  return (
    <section className="workspace-view site-config-view">
      <div className="view-heading site-config-heading">
        <div><span>SITE CONFIGURATION / REVISIONED</span><h1>网站设置</h1></div>
        <div className="site-save-cluster">
          {revision ? <small>发布于 {new Date(revision.createdAt).toLocaleString('zh-CN', { hour12: false })}</small> : <small>尚未创建发布修订</small>}
          <button className="primary-command" type="button" disabled={saving} onClick={() => void save()}>
            {saving ? <LoaderCircle className="spin" /> : saved ? <Check /> : <Save />}{saved ? '已发布' : '发布修订'}
          </button>
        </div>
      </div>
      {error ? <div className="error-notice"><X />{error}</div> : null}

      <div className="site-section">
        <div className="site-section__title"><ImageIcon /><div><h2>品牌资产</h2><p>只接受经服务端复核的 PNG、JPEG、WebP 或 ICO。</p></div></div>
        <div className="asset-selector-grid">
          <AssetSelector kind="logo" label="主 Logo" assets={assets} selectedId={config.logoAssetId} busy={uploading === 'logo'} onSelect={(logoAssetId) => setConfig((current) => ({ ...current, logoAssetId }))} onUpload={(kind, file) => void upload(kind, file)} />
          <AssetSelector kind="favicon" label="Favicon" assets={assets} selectedId={config.faviconAssetId} busy={uploading === 'favicon'} onSelect={(faviconAssetId) => setConfig((current) => ({ ...current, faviconAssetId }))} onUpload={(kind, file) => void upload(kind, file)} />
        </div>
      </div>

      <div className="site-section">
        <div className="site-section__title"><Globe2 /><div><h2>站点与首页</h2><p>保存后立即切换公开站点的当前修订。</p></div></div>
        <div className="site-form-grid">
          <InputField label="网站名称" value={config.siteName} onChange={(siteName) => setConfig((current) => ({ ...current, siteName }))} maxLength={80} />
          <InputField label="短名称" value={config.shortName} onChange={(shortName) => setConfig((current) => ({ ...current, shortName }))} maxLength={32} />
          <InputField label="首页标题" value={config.home.headline} onChange={(headline) => setConfig((current) => ({ ...current, home: { ...current.home, headline } }))} maxLength={80} />
          <InputField label="首页主张" value={config.home.lead} onChange={(lead) => setConfig((current) => ({ ...current, home: { ...current.home, lead } }))} maxLength={120} />
          <label className="site-field site-field--wide"><span>首页描述</span><textarea value={config.home.description} onChange={(event) => setConfig((current) => ({ ...current, home: { ...current.home, description: event.target.value } }))} maxLength={300} /></label>
          <InputField label="主操作文字" value={config.home.primaryActionLabel} onChange={(primaryActionLabel) => setConfig((current) => ({ ...current, home: { ...current.home, primaryActionLabel } }))} maxLength={40} />
        </div>
      </div>

      <div className="site-section">
        <div className="site-section__title"><Settings2 /><div><h2>主题与功能</h2><p>功能开关进入公开投影，不携带管理字段。</p></div></div>
        <div className="site-controls-row">
          <div><span className="control-label">主题预设</span><div className="segmented compact">{(['system', 'light', 'dark'] as const).map((theme) => <button type="button" className={config.themePreset === theme ? 'active' : ''} key={theme} onClick={() => setConfig((current) => ({ ...current, themePreset: theme }))}>{theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}</button>)}</div><span className="control-label nav-label">公开导航</span><div className="navigation-enums">{([['home', '产品'], ['help', '支持'], ['legal', '法律']] as const).map(([item, label]) => <label key={item}><input type="checkbox" checked={config.navigation.includes(item)} disabled={config.navigation.includes(item) && config.navigation.length === 1} onChange={(event) => setConfig((current) => ({ ...current, navigation: event.target.checked ? [...current.navigation, item] : current.navigation.filter((value) => value !== item) }))} />{label}</label>)}</div></div>
          <div className="toggle-stack"><Toggle label="允许注册" checked={config.features.registrationEnabled} onChange={(registrationEnabled) => setConfig((current) => ({ ...current, features: { ...current.features, registrationEnabled } }))} /><Toggle label="反馈入口" checked={config.features.feedbackEnabled} onChange={(feedbackEnabled) => setConfig((current) => ({ ...current, features: { ...current.features, feedbackEnabled } }))} /></div>
        </div>
      </div>

      <div className="site-section">
        <div className="site-section__title"><Link2 /><div><h2>链接</h2><p>仅允许无凭据、无 fragment 的绝对 HTTP(S) 地址。</p></div></div>
        <div className="site-form-grid">
          <NullableField label="帮助中心" value={config.links.helpUrl} onChange={(helpUrl) => setConfig((current) => ({ ...current, links: { ...current.links, helpUrl } }))} placeholder="https://" />
          <NullableField label="问题反馈" value={config.links.feedbackUrl} onChange={(feedbackUrl) => setConfig((current) => ({ ...current, links: { ...current.links, feedbackUrl } }))} placeholder="https://" />
          <NullableField label="用户协议" value={config.links.termsUrl} onChange={(termsUrl) => setConfig((current) => ({ ...current, links: { ...current.links, termsUrl } }))} placeholder="https://" />
          <NullableField label="隐私政策" value={config.links.privacyUrl} onChange={(privacyUrl) => setConfig((current) => ({ ...current, links: { ...current.links, privacyUrl } }))} placeholder="https://" />
          <NullableField label="账号注销说明" value={config.links.accountDeletionUrl} onChange={(accountDeletionUrl) => setConfig((current) => ({ ...current, links: { ...current.links, accountDeletionUrl } }))} placeholder="https://" />
        </div>
      </div>

      <div className="site-section">
        <div className="site-section__title"><FileText /><div><h2>页脚与备案</h2><p>{recordCount} 项主体或备案信息已填写。</p></div></div>
        <div className="site-form-grid">
          <InputField label="页脚描述" value={config.footer.description} onChange={(description) => setConfig((current) => ({ ...current, footer: { ...current.footer, description } }))} maxLength={160} />
          <InputField label="版权文字" value={config.footer.copyright} onChange={(copyright) => setConfig((current) => ({ ...current, footer: { ...current.footer, copyright } }))} maxLength={120} />
          <NullableField label="企业主体" value={config.records.companyName} onChange={(companyName) => setConfig((current) => ({ ...current, records: { ...current.records, companyName } }))} />
          <NullableField label="ICP备案" value={config.records.icpNumber} onChange={(icpNumber) => setConfig((current) => ({ ...current, records: { ...current.records, icpNumber } }))} />
          <NullableField label="公安备案" value={config.records.publicSecurityNumber} onChange={(publicSecurityNumber) => setConfig((current) => ({ ...current, records: { ...current.records, publicSecurityNumber } }))} />
          <label className="site-field"><span>修订备注</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="本次调整原因" /></label>
        </div>
      </div>
    </section>
  )
}
