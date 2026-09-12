import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/hooks/useAuth'

export function SyncPage() {
  const { t } = useTranslation()
  const { showSuccess, element } = useToast()
  const { me } = useAuth()
  const serverUrl = typeof window !== 'undefined' ? `${window.location.origin}/webdav/` : ''
  const username = me?.username || '—'
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    showSuccess(t('common.copied'))
    setTimeout(() => setCopiedField(null), 2000)
  }

  const steps = [t('sync.step1'), t('sync.step2'), t('sync.step3'), t('sync.step4')]
  const troubleshooting = [t('sync.help_403'), t('sync.help_redirect'), t('sync.help_root')]

  return (
    <div className="page-shell scrollbar-thin">
      <div className="page-container-narrow mx-auto">
        <div className="page-eyebrow">{t('settings.sync')}</div>
        <h1 className="font-display page-title">{t('sync.title')}</h1>
        <p className="page-subtitle">{t('sync.intro')}</p>

        {/* Sync boundary */}
        <div className="card-flat sync-boundary">
          <div className="page-eyebrow">{t('sync.sync_boundary')}</div>
          <div className="sync-boundary-grid">
            <div>
              <div className="sync-boundary-label">{t('sync.local_folder')}</div>
              <div className="font-display sync-boundary-value">{username}</div>
            </div>
            <div className="sync-boundary-arrow">↔</div>
            <div className="text-right">
              <div className="sync-boundary-label">{t('sync.remote_workspace')}</div>
              <div className="font-display sync-boundary-value">{username}</div>
            </div>
          </div>
          <div className="sync-boundary-note">{t('sync.read_write_direction')}</div>
        </div>

        {/* Server URL */}
        <div className="sync-field">
          <label className="label">{t('sync.server_url')}</label>
          <div className="sync-copy-row">
            <code className="sync-code">{serverUrl}</code>
            <button className="btn btn-sm" onClick={() => copyText(serverUrl, 'url')}>
              {copiedField === 'url' ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>

        {/* Token */}
        <div className="sync-field">
          <label className="label">{t('sync.token')}</label>
          <p className="sync-token-hint">
            {t('sync.token_hint')} <a href="/settings/tokens" className="sync-link">{t('settings.tokens')}</a>
          </p>
        </div>

        {/* Steps */}
        <div className="card sync-steps-card">
          <div className="page-eyebrow">{t('sync.setup_steps')}</div>
          <ol className="sync-steps">
            {steps.map((step, i) => (
              <li key={i}>
                <span className="sync-step-num">{String(i + 1).padStart(2, '0')}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {/* Troubleshooting */}
        <div className="card-flat sync-troubleshoot">
          <div className="page-eyebrow">{t('sync.troubleshooting')}</div>
          <ul className="sync-troubleshoot-list">
            {troubleshooting.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      {element}
    </div>
  )
}
