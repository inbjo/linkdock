import { useTranslation } from 'react-i18next'

export function AdminPage() {
  const { t } = useTranslation()
  return (
    <div style={{ padding: '1rem', maxWidth: '40rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('nav.admin')}</h1>
      <div className="card">
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', margin: 0 }}>
          System administration dashboard will be available in a future update.
        </p>
      </div>
    </div>
  )
}
