import { useTranslation } from 'react-i18next'

export function ImportExportPage() {
  const { t } = useTranslation()
  return (
    <div style={{ padding: '1rem', maxWidth: '40rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('settings.import_export')}</h1>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Import</h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem 0' }}>
          Import bookmarks from Netscape HTML, Linkwarden JSON, CSV, or XBEL files.
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          This feature will be available in a future update.
        </p>
      </div>
      <div className="card">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Export</h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem 0' }}>
          Export your bookmarks as Netscape HTML, JSON, CSV, or XBEL.
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          This feature will be available in a future update.
        </p>
      </div>
    </div>
  )
}
