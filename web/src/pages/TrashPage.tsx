import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import type { Link } from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'

export function TrashPage() {
  const { t } = useTranslation()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()
  const { me } = useAuth()
  const canWrite = me?.tenant_role !== 'viewer'

  const { data: links, isLoading } = useQuery({
    queryKey: ['links', me?.tenant_id, 'trash'],
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
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin">
      <div style={{ maxWidth: '48rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('trash.title')}
        </div>
        <h1
          className="font-display"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-md)' }}
        >
          {t('trash.title')}
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', marginBottom: 'var(--space-lg)', maxWidth: '32rem' }}>
          {t('trash.description')}
        </p>
        {isLoading ? (
          <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
            {t('common.loading')}
          </div>
        ) : trashLinks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}>
            {trashLinks.map((link) => (
              <TrashItem
                key={link.id}
                link={link}
                onRestore={() => restoreMut.mutate(link.id)}
                onPurge={() => { if (confirm(t('trash.delete_confirm'))) purgeMut.mutate(link.id) }}
                readOnly={!canWrite}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              color: 'var(--color-ink-3)',
              textAlign: 'center',
              padding: 'var(--space-2xl)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {t('trash.empty')}
          </div>
        )}
      </div>
      {element}
    </div>
  )
}

function TrashItem({ link, onRestore, onPurge, readOnly }: { link: Link; onRestore: () => void; onPurge: () => void; readOnly: boolean }) {
  const { t } = useTranslation()
  let domain = ''
  try { domain = new URL(link.url).hostname } catch { domain = link.url }
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--space-sm)',
        border: '1px solid var(--color-rule)',
        borderRadius: 'var(--radius)',
        background: 'var(--color-paper-2)',
        transition: 'border-color var(--dur-short) var(--ease-out)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-rule-strong)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-rule)' }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          className="font-display"
          style={{ fontWeight: 500, fontSize: 'var(--text-sm)', color: 'var(--color-ink)' }}
        >
          {link.name || domain}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-ink-3)',
            marginTop: 'var(--space-3xs)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {link.url}
        </div>
      </div>
      {!readOnly && <div style={{ display: 'flex', gap: 'var(--space-2xs)', flexShrink: 0, marginLeft: 'var(--space-sm)' }}>
        <button className="btn btn-sm" onClick={onRestore}>{t('trash.restore')}</button>
        <button className="btn btn-sm btn-danger" onClick={onPurge}>{t('trash.permanent_delete')}</button>
      </div>}
    </div>
  )
}
