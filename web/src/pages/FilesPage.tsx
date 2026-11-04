import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import type { SyncFile } from '@/lib/types'

function sizeLabel(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FilesPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const qc = useQueryClient()
  const { showError, showSuccess, element } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<File | null>(null)
  const [filename, setFilename] = useState('')
  const [history, setHistory] = useState<SyncFile | null>(null)
  const filesQuery = useQuery({ queryKey: ['files', me?.id], queryFn: () => api.listFiles(), enabled: !!me, refetchInterval: 30_000 })
  const usage = useQuery({ queryKey: ['usage', me?.id], queryFn: () => api.usage(), enabled: !!me, refetchInterval: 30_000 })
  const files = filesQuery.data ?? []
  const historyQuery = useQuery({ queryKey: ['versions', me?.id, history?.path], queryFn: () => api.versions(history!.path), enabled: !!history })
  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['files', me?.id] }), qc.invalidateQueries({ queryKey: ['versions', me?.id] }), qc.invalidateQueries({ queryKey: ['usage', me?.id] })])
  }
  const report = (error: Error) => { showError(error.message); void refresh() }
  const importing = useMutation({
    mutationFn: () => api.importFile(filename, upload!, files.find(file => file.path === filename)?.etag),
    onSuccess: async () => { setUpload(null); showSuccess(t('files.imported')); await refresh() }, onError: report,
  })
  const deleting = useMutation({ mutationFn: (file: SyncFile) => api.deleteFile(file), onSuccess: refresh, onError: report })
  const restoring = useMutation({
    mutationFn: (id: string) => api.restoreVersion(files.find(file => file.path === history!.path) ?? history!, id),
    onSuccess: async () => { showSuccess(t('files.restored')); await refresh() }, onError: report,
  })
  const replacing = files.find(file => file.path === filename)

  return (
    <div className="page-shell scrollbar-thin">
      <div className="page-container mx-auto files-page">
        <div className="token-page-header">
          <div><div className="page-eyebrow">XBEL / WebDAV</div><h1 className="font-display page-title">{t('files.title')}</h1></div>
          <button className="btn btn-primary" onClick={() => input.current?.click()}>+ {t('files.import')}</button>
          <input ref={input} type="file" accept=".xbel,application/xbel+xml,text/xml,application/xml" className="sr-only" aria-label={t('files.import')} onChange={event => {
            const file = event.target.files?.[0]
            if (file) { setUpload(file); setFilename(file.name.endsWith('.xbel') ? file.name : 'bookmarks.xbel') }
            event.target.value = ''
          }} />
        </div>
        <p className="files-intro">{t('files.description')}</p>
        <div className="files-summary"><strong>{files.length.toString().padStart(2, '0')}</strong><span>{t('files.count')}</span><span className="files-summary-size">{sizeLabel(files.reduce((sum, file) => sum + file.size, 0))}</span></div>
        {usage.data ? <div className="ops-usage"><p>{t('ops.files')}: {usage.data.files} / {usage.data.limits.max_files} · {t('ops.stored')}: {sizeLabel(usage.data.stored_bytes)} / {sizeLabel(usage.data.limits.max_storage_bytes)}</p><progress aria-label={t('ops.storage')} value={usage.data.stored_bytes} max={usage.data.limits.max_storage_bytes} /><p className="ops-note">{t('ops.quota_note')}</p></div> : usage.isError ? <p role="alert">{usage.error.message}</p> : null}
        {filesQuery.isPending ? <p role="status">{t('common.loading')}</p> : filesQuery.isError ? <div className="card files-empty" role="alert"><p>{filesQuery.error.message}</p><button className="btn" onClick={() => filesQuery.refetch()}>{t('files.refresh')}</button></div> : files.length === 0 ? (
          <div className="card files-empty"><span className="files-glyph" aria-hidden="true">↓</span><h2 className="font-display">{t('files.empty')}</h2><p>{t('files.empty_hint')}</p><a className="btn" href="/settings/sync">{t('settings.sync')}</a></div>
        ) : <div className="card files-list">{files.map(file => (
          <article key={file.path} className="files-row">
            <span className="files-type" aria-hidden="true">XBEL</span>
            <div className="files-info"><h2 className="font-display">{file.path}</h2><p>{sizeLabel(file.size)} · {t('files.revision', { revision: file.revision })} · {new Date(file.updated_at).toLocaleString()}</p>{file.locked ? <span className="badge">{t('files.locked')}</span> : null}</div>
            <div className="files-actions">
              <a className="btn btn-sm" href={api.fileUrl(file.path)} download={file.path}>{t('files.export')}</a>
              <button className="btn btn-sm" onClick={() => setHistory(file)}>{t('files.history')}</button>
              <button className="btn btn-sm btn-danger" disabled={file.locked || deleting.isPending} onClick={() => { if (confirm(t('files.delete_confirm', { name: file.path }))) deleting.mutate(file) }}>{t('common.delete')}</button>
            </div>
          </article>
        ))}</div>}
      </div>
      <Modal open={!!upload} onClose={() => { if (!importing.isPending) setUpload(null) }} title={t('files.import')}>
        <form className="modal-form" onSubmit={event => { event.preventDefault(); importing.mutate() }}>
          <label className="label" htmlFor="import-name">{t('files.filename')}</label>
          <input id="import-name" className="input" required value={filename} onChange={event => setFilename(event.target.value)} maxLength={255} pattern={String.raw`[^\x2f\x5c]+[.]xbel`} />
          <p className="modal-hint">{upload?.name} · {sizeLabel(upload?.size ?? 0)}</p>
          {replacing ? <p className="token-warning">{t('files.replace_hint')}</p> : null}
          {replacing?.locked ? <p role="status">{t('files.locked')}</p> : null}
          <button className="btn btn-primary" disabled={importing.isPending || !!replacing?.locked}>{importing.isPending ? t('common.loading') : t('files.import')}</button>
        </form>
      </Modal>
      <Modal open={!!history} onClose={() => setHistory(null)} title={`${t('files.history')} · ${history?.path ?? ''}`}>
        <div className="files-history">
          {historyQuery.isPending ? <p>{t('common.loading')}</p> : historyQuery.isError ? <p role="alert">{historyQuery.error.message}</p> : historyQuery.data?.map(version => (
            <div className="files-version" key={version.id}>
              <div><strong>{t('files.revision', { revision: version.revision })}</strong><p>{new Date(version.created_at).toLocaleString()} · {sizeLabel(version.size)}</p></div>
              <div className="files-actions"><a className="btn btn-sm" href={api.fileUrl(history!.path, version.id)} download={history!.path}>{t('files.export')}</a><button className="btn btn-sm" disabled={restoring.isPending || files.find(file => file.path === history?.path)?.locked || version.revision === files.find(file => file.path === history?.path)?.revision} onClick={() => { if (confirm(t('files.restore_confirm'))) restoring.mutate(version.id) }}>{t('files.restore')}</button></div>
            </div>
          ))}
        </div>
      </Modal>
      {element}
    </div>
  )
}
