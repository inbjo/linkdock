import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { CollectionTree } from '@/components/CollectionTree'
import { LinkCard } from '@/components/LinkCard'
import { Drawer } from '@/components/Drawer'
import { Modal } from '@/components/Modal'
import type { CollectionNode, LinkWithTags, Collection } from '@/lib/types'

export function BookmarksPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null)
  const [selectedLinks, setSelectedLinks] = useState<Set<number>>(new Set())
  const [editLink, setEditLink] = useState<LinkWithTags | null>(null)
  const [showNewLink, setShowNewLink] = useState(false)
  const [showNewCollection, setShowNewCollection] = useState(false)
  const [showBatchMove, setShowBatchMove] = useState(false)

  const { data: tree } = useQuery({ queryKey: ['collections', 'tree'], queryFn: () => api.collectionTree() })
  const { data: links, isLoading: linksLoading } = useQuery({
    queryKey: ['links', selectedCollection],
    queryFn: () => api.listLinks(selectedCollection ?? undefined),
  })

  const deleteLinkMut = useMutation({
    mutationFn: (id: number) => api.deleteLink(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links'] })
      showSuccess('Bookmark deleted')
    },
    onError: (e) => showError(e instanceof Error ? e.message : 'Delete failed'),
  })

  const batchDeleteMut = useMutation({
    mutationFn: (ids: number[]) => api.batchDelete(ids, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links'] })
      setSelectedLinks(new Set())
      showSuccess('Bookmarks deleted')
    },
    onError: (e) => showError(e instanceof Error ? e.message : 'Batch delete failed'),
  })

  const batchMoveMut = useMutation({
    mutationFn: ({ ids, target }: { ids: number[]; target: number }) => api.batchMove(ids, target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links'] })
      setSelectedLinks(new Set())
      setShowBatchMove(false)
      showSuccess('Bookmarks moved')
    },
    onError: (e) => showError(e instanceof Error ? e.message : 'Batch move failed'),
  })

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedLinks((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const flatCollections = useCallback((nodes: CollectionNode[]): Collection[] => {
    return nodes.flatMap((n) => [{ ...n, tenant_id: 0, uuid: '', description: n.description, position: 0, created_by: 0, deleted_at: null, created_at: '', updated_at: '' }, ...flatCollections(n.children)])
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Left: Collections */}
      <div style={{ width: '15rem', flexShrink: 0, borderRight: '1px solid var(--color-border)', padding: '0.5rem', overflow: 'auto' }} className="scrollbar-thin">
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
          <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => setShowNewLink(true)}>+ {t('links.new')}</button>
          <button className="btn btn-sm" onClick={() => setShowNewCollection(true)}>+ 📁</button>
        </div>
        {tree && <CollectionTree nodes={tree} selectedId={selectedCollection} onSelect={(id) => { setSelectedCollection(id); setSelectedLinks(new Set()) }} />}
      </div>

      {/* Center: Link list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }} className="scrollbar-thin">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            {selectedCollection ? tree?.find((n) => n.id === selectedCollection)?.name || t('links.title') : t('links.title')}
          </h1>
          {selectedLinks.size > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{t('links.selected', { count: selectedLinks.size })}</span>
              <button className="btn btn-sm" onClick={() => setShowBatchMove(true)}>{t('links.batch_move')}</button>
              <button className="btn btn-sm btn-danger" onClick={() => batchDeleteMut.mutate([...selectedLinks])}>{t('links.batch_delete')}</button>
              <button className="btn btn-sm" onClick={() => setSelectedLinks(new Set())}>{t('common.cancel')}</button>
            </div>
          )}
        </div>
        {linksLoading ? (
          <div>{t('common.loading')}</div>
        ) : links && links.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {links.map((link) => (
              <LinkCardWithTags
                key={link.id}
                linkId={link.id}
                selected={selectedLinks.has(link.id)}
                onSelect={toggleSelect}
                onClick={setEditLink}
              />
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: '2rem' }}>{t('links.empty')}</div>
        )}
      </div>

      {/* Right: Edit drawer */}
      <Drawer open={!!editLink} onClose={() => setEditLink(null)} title={t('links.edit')}>
        {editLink && <LinkEditForm link={editLink} collections={tree ? flatCollections(tree) : []} onSaved={() => { setEditLink(null); qc.invalidateQueries({ queryKey: ['links'] }) }} />}
      </Drawer>

      {/* New link modal */}
      <Modal open={showNewLink} onClose={() => setShowNewLink(false)} title={t('links.new')}>
        <LinkEditForm
          link={null}
          defaultCollection={selectedCollection}
          collections={tree ? flatCollections(tree) : []}
          onSaved={() => { setShowNewLink(false); qc.invalidateQueries({ queryKey: ['links'] }) }}
        />
      </Modal>

      {/* New collection modal */}
      <Modal open={showNewCollection} onClose={() => setShowNewCollection(false)} title={t('collections.new')}>
        <CollectionEditForm collection={null} parentId={selectedCollection} onSaved={() => { setShowNewCollection(false); qc.invalidateQueries({ queryKey: ['collections'] }) }} />
      </Modal>

      {/* Batch move modal */}
      <Modal open={showBatchMove} onClose={() => setShowBatchMove(false)} title={t('links.batch_move')}>
        <BatchMoveForm
          collections={tree ? flatCollections(tree) : []}
          onMove={(target) => batchMoveMut.mutate({ ids: [...selectedLinks], target })}
        />
      </Modal>
      {element}
    </div>
  )
}

function LinkCardWithTags({ linkId, selected, onSelect, onClick }: { linkId: number; selected: boolean; onSelect: (id: number, s: boolean) => void; onClick: (l: LinkWithTags) => void }) {
  const { data: link } = useQuery({ queryKey: ['link', linkId], queryFn: () => api.getLink(linkId), staleTime: 30000 })
  if (!link) return null
  return <LinkCard link={link} selected={selected} onSelect={onSelect} onClick={onClick} />
}

function LinkEditForm({ link, defaultCollection, collections, onSaved }: {
  link: LinkWithTags | null
  defaultCollection?: number | null
  collections: Collection[]
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { showError, showSuccess } = useToast()
  const [url, setUrl] = useState(link?.url || '')
  const [name, setName] = useState(link?.name || '')
  const [description, setDescription] = useState(link?.description || '')
  const [collectionId, setCollectionId] = useState(link?.collection_id || defaultCollection || collections[0]?.id || 0)
  const [tags, setTags] = useState(link?.tags.join(', ') || '')
  const [loading, setLoading] = useState(false)

  const save = async () => {
    if (!url.trim()) {
      showError('URL is required')
      return
    }
    if (!collectionId) {
      showError('Collection is required')
      return
    }
    setLoading(true)
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)
      if (link) {
        await api.updateLink(link.id, { url, name, description, collection_id: collectionId, tags: tagList })
      } else {
        await api.createLink({ url, name, description, collection_id: collectionId, tags: tagList })
      }
      showSuccess(link ? 'Bookmark updated' : 'Bookmark created')
      onSaved()
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label className="label">{t('links.url')}</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
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
        <label className="label">{t('links.collection')}</label>
        <select className="input" value={collectionId} onChange={(e) => setCollectionId(Number(e.target.value))}>
          {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">{t('links.tags')}</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated, tags" />
      </div>
      {link && (
        <button className="btn btn-danger btn-sm" onClick={async () => { await api.deleteLink(link.id); showSuccess('Deleted'); onSaved() }}>
          {t('links.delete')}
        </button>
      )}
      <button className="btn btn-primary" onClick={save} disabled={loading}>
        {loading ? t('common.loading') : link ? t('common.update') : t('common.create')}
      </button>
    </div>
  )
}

function CollectionEditForm({ collection, parentId, onSaved }: {
  collection: Collection | null
  parentId?: number | null
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { showError, showSuccess } = useToast()
  const [name, setName] = useState(collection?.name || '')
  const [parent, setParent] = useState(collection?.parent_id ?? parentId ?? null)
  const [loading, setLoading] = useState(false)

  const save = async () => {
    if (!name.trim()) {
      showError('Name is required')
      return
    }
    setLoading(true)
    try {
      if (collection) {
        await api.updateCollection(collection.id, { name, parent_id: parent })
      } else {
        await api.createCollection({ name, parent_id: parent })
      }
      showSuccess(collection ? 'Collection updated' : 'Collection created')
      onSaved()
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label className="label">{t('collections.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="label">{t('collections.parent')}</label>
        <select className="input" value={parent ?? 0} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : null)}>
          <option value={0}>{t('collections.root')}</option>
        </select>
      </div>
      <button className="btn btn-primary" onClick={save} disabled={loading}>
        {loading ? t('common.loading') : collection ? t('common.update') : t('common.create')}
      </button>
    </div>
  )
}

function BatchMoveForm({ collections, onMove }: { collections: Collection[]; onMove: (target: number) => void }) {
  const { t } = useTranslation()
  const [target, setTarget] = useState(collections[0]?.id || 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label className="label">{t('links.collection')}</label>
        <select className="input" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <button className="btn btn-primary" onClick={() => onMove(target)} disabled={!target}>
        {t('links.batch_move')}
      </button>
    </div>
  )
}
