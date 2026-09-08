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
  const [renameCollection, setRenameCollection] = useState<CollectionNode | null>(null)
  const [deleteCollectionNode, setDeleteCollectionNode] = useState<CollectionNode | null>(null)
  const canWrite = me?.tenant_role !== 'viewer'

  const { data: tree } = useQuery({ queryKey: ['collections', me?.tenant_id, 'tree'], queryFn: () => api.collectionTree() })
  const { data: links, isLoading: linksLoading } = useQuery({
    queryKey: ['links', me?.tenant_id, selectedCollection],
    queryFn: () => api.listLinks(selectedCollection ?? undefined),
  })

  useEffect(() => {
    setSelectedCollection(null)
    setSelectedLinks(new Set())
    setEditLink(null)
  }, [me?.tenant_id])

  const deleteLinkMut = useMutation({
    mutationFn: (id: number) => api.deleteLink(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links'] })
      showSuccess(t('links.deleted'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const batchDeleteMut = useMutation({
    mutationFn: (ids: number[]) => api.batchDelete(ids, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links'] })
      setSelectedLinks(new Set())
      showSuccess(t('links.deleted'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const batchMoveMut = useMutation({
    mutationFn: ({ ids, target }: { ids: number[]; target: number }) => api.batchMove(ids, target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links'] })
      setSelectedLinks(new Set())
      setShowBatchMove(false)
      showSuccess(t('links.moved'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const deleteCollectionMut = useMutation({
    mutationFn: (id: number) => api.deleteCollection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] })
      qc.invalidateQueries({ queryKey: ['links'] })
      setDeleteCollectionNode(null)
      if (selectedCollection === deleteCollectionNode?.id) setSelectedCollection(null)
      showSuccess(t('collections.deleted'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const renameCollectionMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.updateCollection(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] })
      setRenameCollection(null)
      showSuccess(t('collections.updated'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedLinks((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectAll = () => {
    if (links) setSelectedLinks(new Set(links.map((l) => l.id)))
  }

  const flatCollections = useCallback((nodes: CollectionNode[]): Collection[] => {
    return nodes.flatMap((n) => [{ ...n, tenant_id: 0, uuid: '', description: n.description, position: 0, created_by: 0, deleted_at: null, created_at: '', updated_at: '' }, ...flatCollections(n.children)])
  }, [])

  return (
    <div className="bookmarks-shell" style={{ display: 'flex', height: '100%' }}>
      {/* Left: Collections */}
      <div
        className="collections-panel"
        style={{
          width: '14rem',
          flexShrink: 0,
          borderRight: '1px solid var(--color-rule)',
          background: 'var(--color-paper)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: 'var(--space-sm)', borderBottom: '1px solid var(--color-rule)' }}>
          <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
            {t('collections.title')}
          </div>
          {canWrite && <div style={{ display: 'flex', gap: 'var(--space-2xs)' }}>
            <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => setShowNewLink(true)}>
              + {t('links.new')}
            </button>
            <button className="btn btn-sm btn-icon" onClick={() => setShowNewCollection(true)} title={t('collections.new')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 4h4l1 1.5h5v6H2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </button>
          </div>}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-2xs)' }} className="scrollbar-thin">
          {tree && (
            <CollectionTree
              nodes={tree}
              selectedId={selectedCollection}
              onSelect={(id) => { setSelectedCollection(id); setSelectedLinks(new Set()) }}
              onDelete={canWrite ? (id) => {
                const node = findNode(tree, id)
                if (node) setDeleteCollectionNode(node)
              } : undefined}
              onRename={canWrite ? (id) => {
                const node = findNode(tree, id)
                if (node) setRenameCollection(node)
              } : undefined}
            />
          )}
        </div>
      </div>

      {/* Center: Link list */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-md)' }} className="scrollbar-thin bookmarks-main">
        <div className="bookmarks-header">
          <div className="bookmarks-title-group">
            {canWrite && links && links.length > 0 && (
              <label className="checkbox-hit" title={t('links.select_all')}>
                <span className="sr-only">{t('links.select_all')}</span>
                <input
                  className="ui-checkbox"
                  type="checkbox"
                  checked={links.length > 0 && selectedLinks.size === links.length}
                  onChange={(e) => { if (e.target.checked) selectAll(); else setSelectedLinks(new Set()) }}
                  aria-label={t('links.select_all')}
                />
                <span className="ui-checkbox-mark" aria-hidden="true" />
              </label>
            )}
            <div>
              <div className="section-label" style={{ marginBottom: 'var(--space-3xs)' }}>
                {t('links.title')}
              </div>
              <h1
                className="font-display"
                style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}
              >
                {selectedCollection ? tree?.find((n) => n.id === selectedCollection)?.name || t('links.title') : t('links.title')}
              </h1>
            </div>
          </div>
          {selectedLinks.size > 0 && (
            <div className="bookmarks-selection-tools">
              <span className="badge bookmarks-selected-count">{t('links.selected', { count: selectedLinks.size })}</span>
              <button className="btn btn-sm" onClick={() => setShowBatchMove(true)}>{t('links.batch_move')}</button>
              <button className="btn btn-sm btn-danger" onClick={() => batchDeleteMut.mutate([...selectedLinks])}>
                {t('links.batch_delete')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelectedLinks(new Set())}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
        {linksLoading ? (
          <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
            {t('common.loading')}
          </div>
        ) : links && links.length > 0 ? (
          <div className="bookmarks-list">
            {links.map((link) => (
              <LinkCardWithTags
                key={link.id}
                linkId={link.id}
                selected={selectedLinks.has(link.id)}
                onSelect={toggleSelect}
                onClick={setEditLink}
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
            {t('links.empty')}
          </div>
        )}
      </div>

      {/* Right: Edit drawer */}
      <Drawer open={!!editLink} onClose={() => setEditLink(null)} title={t('links.edit')}>
        {editLink && (
          <LinkEditForm
            link={editLink}
            collections={tree ? flatCollections(tree) : []}
            onSaved={() => { setEditLink(null); qc.invalidateQueries({ queryKey: ['links'] }) }}
          />
        )}
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

      {/* Rename collection modal */}
      <Modal open={!!renameCollection} onClose={() => setRenameCollection(null)} title={t('collections.edit')}>
        {renameCollection && (
          <RenameCollectionForm
            node={renameCollection}
            onRename={(name) => renameCollectionMut.mutate({ id: renameCollection.id, name })}
            loading={renameCollectionMut.isPending}
          />
        )}
      </Modal>

      {/* Delete collection confirm modal */}
      <Modal
        open={!!deleteCollectionNode}
        onClose={() => setDeleteCollectionNode(null)}
        title={t('collections.delete')}
      >
        {deleteCollectionNode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', margin: 0 }}>
              {t('collections.delete_confirm')}
            </p>
            <div style={{ padding: 'var(--space-sm)', background: 'var(--color-paper-3)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
              {deleteCollectionNode.name}
              {deleteCollectionNode.children.length > 0 && (
                <span style={{ color: 'var(--color-ink-3)', marginLeft: 'var(--space-2xs)' }}>
                  ({deleteCollectionNode.children.length} sub-folders)
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2xs)' }}>
              <button
                className="btn btn-danger"
                onClick={() => deleteCollectionMut.mutate(deleteCollectionNode.id)}
                disabled={deleteCollectionMut.isPending}
              >
                {deleteCollectionMut.isPending ? t('common.loading') : t('common.delete')}
              </button>
              <button className="btn" onClick={() => setDeleteCollectionNode(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </Modal>
      {element}
    </div>
  )
}

function LinkCardWithTags({ linkId, selected, onSelect, onClick, readOnly }: { linkId: number; selected: boolean; onSelect: (id: number, s: boolean) => void; onClick: (l: LinkWithTags) => void; readOnly: boolean }) {
  const { me } = useAuth()
  const { data: link } = useQuery({ queryKey: ['link', me?.tenant_id, linkId], queryFn: () => api.getLink(linkId), staleTime: 30000 })
  if (!link) return null
  return <LinkCard link={link} selected={selected} onSelect={onSelect} onClick={onClick} readOnly={readOnly} />
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
      showError(t('links.url') + ' is required')
      return
    }
    if (!collectionId) {
      showError(t('links.collection') + ' is required')
      return
    }
    setLoading(true)
    try {
      const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      if (link) {
        await api.updateLink(link.id, { url, name, description, collection_id: collectionId, tags: tagList })
      } else {
        await api.createLink({ url, name, description, collection_id: collectionId, tags: tagList })
      }
      showSuccess(link ? t('links.updated') : t('links.created'))
      onSaved()
    } catch (err) {
      showError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div>
        <label className="label">{t('links.url')}</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus placeholder="https://" />
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
        <button className="btn btn-sm btn-danger" onClick={async () => { await api.deleteLink(link.id); showSuccess(t('links.deleted')); onSaved() }}>
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
      showError(t('common.name') + ' is required')
      return
    }
    setLoading(true)
    try {
      if (collection) {
        await api.updateCollection(collection.id, { name, parent_id: parent })
      } else {
        await api.createCollection({ name, parent_id: parent })
      }
      showSuccess(collection ? t('collections.updated') : t('collections.created'))
      onSaved()
    } catch (err) {
      showError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
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

function RenameCollectionForm({ node, onRename, loading }: { node: CollectionNode; onRename: (name: string) => void; loading: boolean }) {
  const { t } = useTranslation()
  const [name, setName] = useState(node.name)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div>
        <label className="label">{t('collections.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <button className="btn btn-primary" onClick={() => onRename(name)} disabled={!name.trim() || loading}>
        {loading ? t('common.loading') : t('common.save')}
      </button>
    </div>
  )
}

function findNode(nodes: CollectionNode[], id: number): CollectionNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findNode(n.children, id)
    if (found) return found
  }
  return null
}
