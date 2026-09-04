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

  return (
    <div style={{ padding: '1rem', maxWidth: '40rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('settings.import_export')}</h1>

      {/* Import section */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>{t('import_export.import_title')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label className="label">{t('import_export.format')}</label>
            <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="html">Netscape Bookmark HTML</option>
              <option value="json">Linkdock JSON</option>
              <option value="csv">CSV</option>
              <option value="xbel">XBEL</option>
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
          <button className="btn btn-primary" onClick={handleUpload} disabled={!file || loading}>
            {loading ? t('common.loading') : t('import_export.upload')}
          </button>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>{t('import_export.preview')}</h3>
          <div style={{ fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
            <strong>{preview.preview.total_bookmarks}</strong> {t('import_export.total_bookmarks').toLowerCase()} · <strong>{preview.preview.total_folders}</strong> {t('import_export.total_folders').toLowerCase()}
          </div>
          {preview.preview.folders.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div className="label">{t('import_export.total_folders')}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', maxHeight: '8rem', overflow: 'auto' }} className="scrollbar-thin">
                {preview.preview.folders.map((f) => <div key={f}>{f}</div>)}
              </div>
            </div>
          )}
          {preview.preview.sample.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div className="label">{t('import_export.sample')}</div>
              <div style={{ fontSize: '0.75rem' }}>
                {preview.preview.sample.map((b, i) => (
                  <div key={i} style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--color-border)' }}>
                    <strong>{b.name || b.url}</strong> — {b.url}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label className="label">{t('import_export.duplicate_strategy')}</label>
              <select className="input" value={duplicateStrategy} onChange={(e) => setDuplicateStrategy(e.target.value)}>
                <option value="keep">{t('import_export.keep')}</option>
                <option value="skip">{t('import_export.skip')}</option>
                <option value="update">{t('import_export.update')}</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" onClick={handleExecute} disabled={loading}>
                {loading ? t('common.loading') : t('import_export.execute')}
              </button>
              <button className="btn" onClick={() => setPreview(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Export section */}
      <div className="card">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>{t('import_export.export_title')}</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => handleExport('html')}>Bookmark HTML</button>
          <button className="btn" onClick={() => handleExport('json')}>JSON</button>
          <button className="btn" onClick={() => handleExport('csv')}>CSV</button>
          <button className="btn" onClick={() => handleExport('xbel')}>XBEL</button>
        </div>
      </div>
      {element}
    </div>
  )
}
