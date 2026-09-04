import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { LinkCard } from '@/components/LinkCard'
import { Drawer } from '@/components/Drawer'
import { useToast } from '@/components/Toast'
import type { LinkWithTags } from '@/lib/types'

export function SearchPage() {
  const { t } = useTranslation()
  const { element } = useToast()
  const [query, setQuery] = useState('')
  const [editLink, setEditLink] = useState<LinkWithTags | null>(null)
  const [searchKey, setSearchKey] = useState('')

  const { data: allLinks, isLoading } = useQuery({
    queryKey: ['links', 'all', searchKey],
    queryFn: () => api.listLinks(),
  })

  const filtered = (allLinks || []).filter((l) => {
    if (!query) return true
    const q = query.toLowerCase()
    return l.name.toLowerCase().includes(q) || l.url.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
  })

  // Fetch tags for each link
  return (
    <div style={{ padding: '1rem', height: '100%', overflow: 'auto' }} className="scrollbar-thin">
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('nav.search')}</h1>
      <input
        className="input"
        placeholder={t('common.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: '1rem', maxWidth: '32rem' }}
        autoFocus
      />
      {isLoading ? (
        <div>{t('common.loading')}</div>
      ) : filtered.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '48rem' }}>
          {filtered.map((link) => (
            <LinkCardWithTags key={link.id} linkId={link.id} onClick={setEditLink} />
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--color-text-secondary)' }}>{t('links.empty')}</div>
      )}
      <Drawer open={!!editLink} onClose={() => setEditLink(null)} title={t('links.edit')}>
        {editLink && <LinkDetail linkId={editLink.id} onSaved={() => setEditLink(null)} />}
      </Drawer>
      {element}
    </div>
  )
}

function LinkCardWithTags({ linkId, onClick }: { linkId: number; onClick: (l: LinkWithTags) => void }) {
  const { data: link } = useQuery({ queryKey: ['link', linkId], queryFn: () => api.getLink(linkId), staleTime: 30000 })
  if (!link) return null
  return <LinkCard link={link} selected={false} onSelect={() => {}} onClick={onClick} />
}

function LinkDetail({ linkId, onSaved }: { linkId: number; onSaved: () => void }) {
  const { data: link } = useQuery({ queryKey: ['link', linkId], queryFn: () => api.getLink(linkId) })
  if (!link) return <div>Loading...</div>
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
      showSuccess('Updated')
      onSaved()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div><label className="label">{t('links.url')}</label><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      <div><label className="label">{t('links.name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">{t('links.description')}</label><textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div><label className="label">{t('links.tags')}</label><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
    </div>
  )
}
