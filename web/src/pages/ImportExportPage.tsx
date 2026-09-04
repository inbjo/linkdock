import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import type { ParsedBookmark } from '@/lib/types'

interface ImportPreviewData {
  preview: {
    format: string
    total_bookmarks: number
    total_folders: number
    folders: string[]
    sample: ParsedBookmark[]
  }
  bookmarks: ParsedBookmark[]
}

export function ImportExportPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const [format, setFormat] = useState('html')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [duplicateStrategy, setDuplicateStrategy] = useState('keep')
  const [targetCollection, setTargetCollection] = useState<string>('')

  const handleUpload = async () => {
    if (!file) {
      showError(t('import_export.select_file'))
      return
    }
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('format', format)
      const resp = await fetch('/api/app/v1/import/upload', {
        credentials: 'same-origin',
        method: 'POST',
        body: formData,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error?.message || `HTTP ${resp.status}`)
      }
      const data: ImportPreviewData = await resp.json()
      setPreview(data)
      showSuccess(t('import_export.parsed', { count: data.preview.total_bookmarks, folders: data.preview.total_folders }))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = async () => {
    if (!preview) return
    setLoading(true)
    try {
      const resp = await fetch('/api/app/v1/import/execute', {
        credentials: 'same-origin',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookmarks: preview.bookmarks,
          target_collection_id: targetCollection ? Number(targetCollection) : null,
          duplicate_strategy: duplicateStrategy,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error?.message || `HTTP ${resp.status}`)
      }
      const result = await resp.json()
      showSuccess(t('import_export.imported', { count: result.success }))
      setPreview(null)
      setFile(null)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleExport = (fmt: string) => {
    window.open(`/api/app/v1/export/${fmt}`, '_blank')
  }

  if (!me) return null

  const formats = [
    { value: 'html', label: 'Netscape Bookmark HTML' },
    { value: 'json', label: 'Linkdock JSON' },
    { value: 'csv', label: 'CSV' },
    { value: 'xbel', label: 'XBEL' },
  ]

  return (
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin">
      <div style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('settings.import_export')}
        </div>
        <h1
          className="font-display"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-lg)' }}
        >
          {t('import_export.title')}
        </h1>

        {/* Import */}
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>
            {t('import_export.import_title')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div>
              <label className="label">{t('import_export.format')}</label>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
                {formats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('import_export.select_file')}</label>
              <input
                type="file"
                className="input"
                accept=".html,.htm,.json,.csv,.xbel"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <button className="btn btn-primary" onClick={handleUpload} disabled={!file || loading} style={{ alignSelf: 'flex-start' }}>
              {loading ? t('common.loading') : t('import_export.upload')}
            </button>
          </div>
        </div>

        {/* Preview */}
        {preview && (
          <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
            <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>
              {t('import_export.preview')}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
              <div>
                <div className="font-display" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-accent)' }}>
                  {preview.preview.total_bookmarks}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', textTransform: 'uppercase' }}>
                  {t('import_export.total_bookmarks')}
                </div>
              </div>
              <div>
                <div className="font-display" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-ink)' }}>
                  {preview.preview.total_folders}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', textTransform: 'uppercase' }}>
                  {t('import_export.total_folders')}
                </div>
              </div>
            </div>
            {preview.preview.folders.length > 0 && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <label className="label">{t('import_export.total_folders')}</label>
                <div
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', maxHeight: '8rem', overflow: 'auto', fontFamily: 'var(--font-mono)' }}
                  className="scrollbar-thin"
                >
                  {preview.preview.folders.map((f) => <div key={f}>{f}</div>)}
                </div>
              </div>
            )}
            {preview.preview.sample.length > 0 && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <label className="label">{t('import_export.sample')}</label>
                <div style={{ fontSize: 'var(--text-xs)' }}>
                  {preview.preview.sample.map((b, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 'var(--space-2xs) 0',
                        borderBottom: '1px solid var(--color-rule)',
                      }}
                    >
                      <span className="font-display" style={{ fontWeight: 500 }}>{b.name || b.url}</span>
                      <span style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', marginLeft: 'var(--space-2xs)' }}>
                        {b.url}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div>
                <label className="label">{t('import_export.duplicate_strategy')}</label>
                <select className="input" value={duplicateStrategy} onChange={(e) => setDuplicateStrategy(e.target.value)}>
                  <option value="keep">{t('import_export.keep')}</option>
                  <option value="skip">{t('import_export.skip')}</option>
                  <option value="update">{t('import_export.update')}</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2xs)' }}>
                <button className="btn btn-primary" onClick={handleExecute} disabled={loading}>
                  {loading ? t('common.loading') : t('import_export.execute')}
                </button>
                <button className="btn" onClick={() => setPreview(null)}>{t('common.cancel')}</button>
              </div>
            </div>
          </div>
        )}

        {/* Export */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>
            {t('import_export.export_title')}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2xs)', flexWrap: 'wrap' }}>
            {formats.map((f) => (
              <button key={f.value} className="btn btn-sm" onClick={() => handleExport(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {element}
    </div>
  )
}
