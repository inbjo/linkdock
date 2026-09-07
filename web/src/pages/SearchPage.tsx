import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { LinkCard } from '@/components/LinkCard'
import { Drawer } from '@/components/Drawer'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/hooks/useAuth'
import type { LinkWithTags } from '@/lib/types'

export function SearchPage() {
  const { t } = useTranslation()
  const { element } = useToast()
  const { me } = useAuth()
  const readOnly = me?.tenant_role === 'viewer'
  const [query, setQuery] = useState('')
  const [editLink, setEditLink] = useState<LinkWithTags | null>(null)

  const { data: allLinks, isLoading } = useQuery({
    queryKey: ['links', me?.tenant_id, 'all'],
    queryFn: () => api.listLinks(),
  })

  const filtered = (allLinks || []).filter((l) => {
    if (!query) return true
    const q = query.toLowerCase()
    return l.name.toLowerCase().includes(q) || l.url.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
  })

  return (
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin">
      <div style={{ maxWidth: '48rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('nav.search')}
        </div>
        <h1
          className="font-display"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-md)' }}
        >
          {t('search.title')}
        </h1>
        <div style={{ position: 'relative', marginBottom: 'var(--space-md)' }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ position: 'absolute', left: 'var(--space-xs)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-3)', pointerEvents: 'none' }}
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="input"
            placeholder={t('common.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: '2.25rem' }}
            autoFocus
          />
        </div>
        {isLoading ? (
          <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
            {t('common.loading')}
          </div>
        ) : filtered.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}>
            {filtered.map((link) => (
              <LinkCardWithTags key={link.id} linkId={link.id} onClick={setEditLink} readOnly={readOnly} />
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
            {query ? t('search.no_results') : t('links.empty')}
          </div>
        )}
      </div>
      <Drawer open={!!editLink} onClose={() => setEditLink(null)} title={t('links.edit')}>
        {editLink && <LinkDetail linkId={editLink.id} onSaved={() => setEditLink(null)} />}
      </Drawer>
      {element}
    </div>
  )
}

function LinkCardWithTags({ linkId, onClick, readOnly }: { linkId: number; onClick: (l: LinkWithTags) => void; readOnly: boolean }) {
  const { me } = useAuth()
  const { data: link } = useQuery({ queryKey: ['link', me?.tenant_id, linkId], queryFn: () => api.getLink(linkId), staleTime: 30000 })
  if (!link) return null
  return <LinkCard link={link} selected={false} onSelect={() => {}} onClick={onClick} readOnly={readOnly} />
}

function LinkDetail({ linkId, onSaved }: { linkId: number; onSaved: () => void }) {
  const { me } = useAuth()
  const { data: link } = useQuery({ queryKey: ['link', me?.tenant_id, linkId], queryFn: () => api.getLink(linkId) })
  if (!link) return <div style={{ color: 'var(--color-ink-3)' }}>Loading...</div>
  return <LinkEditInline link={link} onSaved={onSaved} />
}

function LinkEditInline({ link, onSaved }: { link: LinkWithTags; onSaved: () => void }) {
  const { t } = useTranslation()
  const { showError, showSuccess } = useToast()
  const [name, setName] = useState(link.name)
  const [url, setUrl] = useState(link.url)
  const [description, setDescription] = useState(link.description)
  const [tags, setTags] = useState(link.tags.join(', '))

  const save = async () => {
    try {
      await api.updateLink(link.id, { url, name, description, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
      showSuccess(t('links.updated'))
      onSaved()
    } catch (e) {
      showError(e instanceof Error ? e.message : t('common.error'))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div>
        <label className="label">{t('links.url')}</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div>
        <label className="label">{t('links.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">{t('links.description')}</label>
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="label">{t('links.tags')}</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
    </div>
  )
}
