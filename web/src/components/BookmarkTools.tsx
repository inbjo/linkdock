import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useToast } from './Toast'

export function BookmarkTools({ documentId, revision, onChanged }: {
  documentId: number; revision: number; onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { showError, showSuccess, element } = useToast()
  const [mode, setMode] = useState<'search' | 'trash' | 'history'>('search')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(input.trim()); setOffset(0) }, 250)
    return () => window.clearTimeout(timer)
  }, [input])
  const results = useQuery({
    queryKey: ['bookmark-tools', documentId, mode, query, offset, revision],
    queryFn: () => mode === 'trash' ? api.trash(documentId, offset) : api.searchNodes(documentId, query, offset),
    enabled: mode === 'trash' || (mode === 'search' && query.length > 0),
  })
  const history = useQuery({
    queryKey: ['bookmark-tools', documentId, 'snapshots', revision],
    queryFn: () => api.snapshots(documentId),
    enabled: mode === 'history',
  })
  const restore = useMutation({
    mutationFn: ({ id, snapshot }: { id: number; snapshot: boolean }) => snapshot
      ? api.restoreSnapshot(id, revision) : api.restoreNode(id, revision),
    onSuccess: async () => { await onChanged(); showSuccess(t('tree.restored')) },
    onError: (error) => showError(error instanceof Error ? error.message : t('common.error')),
  })
  const active = mode !== 'search' || query.length > 0
  const pending = mode === 'history' ? history.isPending : results.isPending
  const failed = mode === 'history' ? history.isError : results.isError
  return <section className="bookmark-tools" aria-label={t('tree.tools')}>
    <div className="bookmark-tools-bar">
      <label className="bookmark-search">
        <span className="sr-only">{t('search.title')}</span>
        <input className="input" type="search" maxLength={256} value={input} placeholder={t('tree.search_hint')}
          onChange={(event) => { setMode('search'); setInput(event.target.value) }} />
      </label>
      <button className="btn btn-secondary" aria-pressed={mode === 'trash'} onClick={() => { setMode(mode === 'trash' ? 'search' : 'trash'); setOffset(0) }}>{t('tree.trash')}</button>
      <button className="btn btn-secondary" aria-pressed={mode === 'history'} onClick={() => { setMode(mode === 'history' ? 'search' : 'history'); setOffset(0) }}>{t('tree.history')}</button>
    </div>
    {active && <div className="bookmark-tools-results" aria-live="polite" aria-busy={pending}>
      <p className="bookmark-tools-caption">{mode === 'history' ? t('tree.history_hint') : mode === 'trash' ? t('tree.trash_hint') : t('search.title')}</p>
      {failed ? <p role="alert">{t('common.error')} <button className="btn btn-ghost" onClick={() => mode === 'history' ? history.refetch() : results.refetch()}>{t('tree.refresh')}</button></p>
        : pending ? <p>{t('common.loading')}</p>
        : mode === 'history' ? <>
          {!history.data?.length && <p>{t('tree.no_history')}</p>}
          {history.data?.map((snapshot) => <div className="bookmark-result" key={snapshot.id}>
            <div><strong>{t('tree.snapshot_revision', { revision: snapshot.revision })}</strong><small>{new Date(snapshot.created_at).toLocaleString()}</small></div>
            <button className="btn btn-secondary" disabled={restore.isPending} onClick={() => {
              if (window.confirm(t('tree.restore_confirm'))) restore.mutate({ id: snapshot.id, snapshot: true })
            }}>{t('tree.restore')}</button>
          </div>)}
        </> : <>
          {!results.data?.length && <p>{t('search.no_results')}</p>}
          {results.data?.map((node) => <div className="bookmark-result" key={node.id}>
            <div>{mode === 'search' && node.url && /^https?:\/\//i.test(node.url)
              ? <a href={node.url} target="_blank" rel="noopener noreferrer">{node.title || node.url}</a>
              : <strong>{node.title || t('tree.separator')}</strong>}
              <small>{node.url || node.node_type}</small></div>
            {mode === 'trash' && <button className="btn btn-secondary" disabled={restore.isPending} onClick={() => restore.mutate({ id: node.id, snapshot: false })}>{t('tree.restore')}</button>}
          </div>)}
          <div className="bookmark-tools-pagination">
            <button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>{t('tree.previous')}</button>
            <button className="btn btn-ghost" disabled={(results.data?.length || 0) < 100} onClick={() => setOffset(offset + 100)}>{t('tree.next')}</button>
          </div>
        </>}
    </div>}
    {element}
  </section>
}
