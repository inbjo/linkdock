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
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin page-shell">
      <div className="page-container-narrow" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('settings.sync')}
        </div>
        <h1
          className="font-display"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-sm)' }}
        >
          {t('sync.title')}
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', lineHeight: 1.6, marginBottom: 'var(--space-lg)' }}>
          {t('sync.intro')}
        </p>

        <div className="card-flat" style={{ marginBottom: 'var(--space-md)' }}>
          <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>{t('sync.sync_boundary')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>{t('sync.local_folder')}</div>
              <div className="font-display" style={{ marginTop: 'var(--space-3xs)', fontWeight: 600 }}>{username}</div>
            </div>
            <div style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>↔</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>{t('sync.remote_workspace')}</div>
              <div className="font-display" style={{ marginTop: 'var(--space-3xs)', fontWeight: 600 }}>{username}</div>
            </div>
          </div>
          <div style={{ marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--color-rule)', color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)', lineHeight: 1.55 }}>
            {t('sync.read_write_direction')}
          </div>
        </div>

        {/* Server URL */}
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <label className="label">{t('sync.server_url')}</label>
          <div style={{ display: 'flex', gap: 'var(--space-2xs)', alignItems: 'center' }}>
            <code
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-2xs) var(--space-sm)',
                background: 'var(--color-paper-3)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-rule)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {serverUrl}
            </code>
            <button className="btn btn-sm" onClick={() => copyText(serverUrl, 'url')}>
              {copiedField === 'url' ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>

        {/* Token */}
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <label className="label">{t('sync.token')}</label>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', marginBottom: 'var(--space-2xs)' }}>
            {t('sync.token_hint')} <a href="/settings/tokens">{t('settings.tokens')}</a>
          </p>
        </div>

        {/* Steps */}
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>
            {t('sync.setup_steps')}
          </div>
          <ol style={{ margin: 0, paddingLeft: 'var(--space-md)', fontSize: 'var(--text-sm)', lineHeight: 1.7, color: 'var(--color-ink)' }}>
            {steps.map((step, i) => (
              <li key={i} style={{ marginBottom: 'var(--space-2xs)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-accent)', marginRight: 'var(--space-2xs)' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {/* Troubleshooting */}
        <div className="card-flat">
          <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>
            {t('sync.troubleshooting')}
          </div>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-md)', fontSize: 'var(--text-sm)', lineHeight: 1.7, color: 'var(--color-ink-2)' }}>
            {troubleshooting.map((item, i) => (
              <li key={i} style={{ marginBottom: 'var(--space-2xs)' }}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      {element}
    </div>
  )
}
