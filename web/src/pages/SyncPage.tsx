import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/Toast'

export function SyncPage() {
  const { t } = useTranslation()
  const { element } = useToast()
  const serverUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div style={{ padding: '1rem', maxWidth: '40rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('sync.title')}</h1>
      <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
        {t('sync.intro')}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('sync.server_url')}</div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <code style={{ flex: 1, fontSize: '0.8125rem', padding: '0.375rem 0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }}>
            {serverUrl}
          </code>
          <button className="btn btn-sm" onClick={() => copyText(serverUrl)}>Copy</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('sync.token')}</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          Create an access token on the <a href="/settings/tokens">Tokens</a> page, then paste it here:
        </div>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
          <input className="input" placeholder="lw_..." readOnly value="" />
          <button className="btn btn-sm" onClick={() => copyText('')}>Copy</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Setup Steps</h3>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8125rem', lineHeight: 1.6 }}>
          <li>{t('sync.step1')}</li>
          <li>{t('sync.step2')}</li>
          <li>{t('sync.step3')}</li>
          <li>{t('sync.step4')}</li>
        </ol>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Troubleshooting</h3>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8125rem', lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
          <li>{t('sync.help_403')}</li>
          <li>{t('sync.help_redirect')}</li>
          <li>{t('sync.help_root')}</li>
        </ul>
      </div>
      {element}
    </div>
  )
}
