import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import type { Link } from '@/lib/types'

export function TrashPage() {
  const { t } = useTranslation()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()

  const { data: links, isLoading } = useQuery({
    queryKey: ['links', 'trash'],
    queryFn: () => api.listLinks(undefined, true),
  })

  const trashLinks = (links || []).filter((l) => l.deleted_at !== null)

  const restoreMut = useMutation({
    mutationFn: (id: number) => api.restoreLink(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['links'] }); showSuccess(t('links.restored')) },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const purgeMut = useMutation({
    mutationFn: (id: number) => api.batchDelete([id], true),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['links'] }); showSuccess(t('links.deleted')) },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  return (
    <div style={{ padding: '1rem', height: '100%', overflow: 'auto' }} className="scrollbar-thin">
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('trash.title')}</h1>
      {isLoading ? (
        <div>{t('common.loading')}</div>
      ) : trashLinks.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '48rem' }}>
          {trashLinks.map((link) => (
            <TrashItem key={link.id} link={link} onRestore={() => restoreMut.mutate(link.id)} onPurge={() => { if (confirm(t('trash.delete_confirm'))) purgeMut.mutate(link.id) }} />
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--color-text-secondary)' }}>{t('trash.empty')}</div>
      )}
      {element}
    </div>
  )
}

function TrashItem({ link, onRestore, onPurge }: { link: Link; onRestore: () => void; onPurge: () => void }) {
  const { t } = useTranslation()
  let domain = ''
  try { domain = new URL(link.url).hostname } catch { domain = link.url }
  return (
    <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{link.name || domain}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{link.url}</div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button className="btn btn-sm" onClick={onRestore}>{t('trash.restore')}</button>
        <button className="btn btn-sm btn-danger" onClick={onPurge}>{t('trash.permanent_delete')}</button>
      </div>
    </div>
  )
}
