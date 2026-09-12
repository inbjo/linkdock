import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/Modal'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { BookmarkNodeType, BookmarkTreeNode } from '@/lib/types'

type EditorState =
  | { mode: 'create'; parentId: number | null; node: null }
  | { mode: 'edit'; parentId: number | null; node: BookmarkTreeNode }

export function BookmarksPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const queryClient = useQueryClient()
  const canWrite = me?.tenant_role !== 'viewer'
  const [documentId, setDocumentId] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)

  const documents = useQuery({
    queryKey: ['documents', me?.tenant_id],
    queryFn: () => api.listDocuments(),
  })
  useEffect(() => {
    if (!documentId && documents.data?.length) setDocumentId(documents.data[0].id)
  }, [documentId, documents.data])

  const tree = useQuery({
    queryKey: ['bookmark-tree', me?.tenant_id, documentId],
    queryFn: () => api.bookmarkTree(documentId!),
    enabled: documentId !== null,
  })
  const currentDocument = documents.data?.find((document) => document.id === documentId)
  const folders = useMemo(() => collectFolders(tree.data || []), [tree.data])

  const refreshTree = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      queryClient.invalidateQueries({ queryKey: ['bookmark-tree'] }),
    ])
  }
  const createDefault = useMutation({
    mutationFn: () => api.ensureDefaultDocument(),
    onSuccess: async (document) => {
      setDocumentId(document.id)
      await refreshTree()
    },
    onError: (error) => showError(error instanceof Error ? error.message : t('common.error')),
  })
  const removeNode = useMutation({
    mutationFn: (id: number) => api.deleteNode(id),
    onSuccess: async () => { await refreshTree(); showSuccess(t('tree.deleted')) },
    onError: (error) => showError(error instanceof Error ? error.message : t('common.error')),
  })
  const reorder = useMutation({
    mutationFn: ({ parentId, ids }: { parentId: number | null; ids: number[] }) =>
      api.reorderNodes(documentId!, parentId, ids),
    onSuccess: refreshTree,
    onError: (error) => showError(error instanceof Error ? error.message : t('common.error')),
  })
  const moveNode = useMutation({
    mutationFn: ({ id, parentId }: { id: number; parentId: number | null }) =>
      api.updateNode(id, { parent_id: parentId }),
    onSuccess: refreshTree,
    onError: (error) => showError(error instanceof Error ? error.message : t('common.error')),
  })

  const move = (siblings: BookmarkTreeNode[], index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= siblings.length) return
    const ids = siblings.map((node) => node.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorder.mutate({ parentId: siblings[index].parent_id, ids })
  }

  // Reorder a sibling list after a drag-and-drop within the same parent.
  const dropReorder = (parentId: number | null, ids: number[]) => {
    reorder.mutate({ parentId, ids })
  }
  // Move a node to a new parent (appended at the end), then the tree refreshes.
  const dropMove = (id: number, parentId: number | null) => {
    moveNode.mutate({ id, parentId })
  }

  return (
    <div className="tree-workspace page-shell">
      <header className="tree-hero">
        <div>
          <div className="section-label">{t('tree.eyebrow')}</div>
          <h1 className="font-display tree-title">{currentDocument?.title || t('tree.title')}</h1>
          <p className="tree-subtitle">{t('tree.subtitle')}</p>
        </div>
        <div className="tree-toolbar">
          {documents.data && documents.data.length > 0 && (
            <label className="tree-document-select">
              <span>{t('tree.document')}</span>
              <select
                className="input"
                value={documentId ?? ''}
                onChange={(event) => setDocumentId(Number(event.target.value))}
              >
                {documents.data.map((document) => (
                  <option key={document.id} value={document.id}>{document.path}</option>
                ))}
              </select>
            </label>
          )}
          {canWrite && documentId && (
            <button className="btn btn-primary" onClick={() => setEditor({ mode: 'create', parentId: null, node: null })}>
              {t('tree.add_root')}
            </button>
          )}
        </div>
      </header>

      <main className="tree-canvas">
        {documents.isLoading || tree.isLoading ? (
          <div className="tree-empty">{t('common.loading')}</div>
        ) : !documents.data?.length ? (
          <div className="tree-empty">
            <div className="tree-empty-mark">XBEL</div>
            <h2 className="font-display">{t('tree.no_document')}</h2>
            <p>{t('tree.no_document_hint')}</p>
            {canWrite && (
              <button className="btn btn-primary" onClick={() => createDefault.mutate()} disabled={createDefault.isPending}>
                {t('tree.create_document')}
              </button>
            )}
          </div>
        ) : tree.data?.length ? (
          <div className="tree-outline" role="tree" aria-label={t('tree.title')}>
            <TreeLevel
              nodes={tree.data}
              depth={0}
              parentId={null}
              canWrite={canWrite}
              onAdd={(parentId) => setEditor({ mode: 'create', parentId, node: null })}
              onEdit={(node) => setEditor({ mode: 'edit', parentId: node.parent_id, node })}
              onDelete={(node) => {
                if (window.confirm(t('tree.delete_confirm', { name: node.title || t('tree.separator') }))) {
                  removeNode.mutate(node.id)
                }
              }}
              onMove={move}
              onDropReorder={dropReorder}
              onDropMove={dropMove}
            />
          </div>
        ) : (
          <div className="tree-empty">
            <div className="tree-empty-mark">00</div>
            <h2 className="font-display">{t('tree.empty')}</h2>
            <p>{t('tree.empty_hint')}</p>
            {canWrite && (
              <button className="btn btn-primary" onClick={() => setEditor({ mode: 'create', parentId: null, node: null })}>
                {t('tree.add_first')}
              </button>
            )}
          </div>
        )}
      </main>

      <footer className="tree-status">
        <span>{currentDocument?.path || '—'}</span>
        <span>{currentDocument ? `rev ${currentDocument.revision}` : '—'}</span>
        <span>{t('tree.node_count', { count: countNodes(tree.data || []) })}</span>
      </footer>

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.mode === 'edit' ? t('tree.edit_node') : t('tree.new_node')}
      >
        {editor && documentId && (
          <NodeForm
            documentId={documentId}
            state={editor}
            folders={folders}
            onDone={async () => { setEditor(null); await refreshTree() }}
          />
        )}
      </Modal>
      {element}
    </div>
  )
}

// Module-level drag state shared across TreeLevel instances so a node can be
// dragged from one sibling list and dropped into another (or into a folder).
let draggedNodeId: number | null = null

function TreeLevel({ nodes, depth, parentId, canWrite, onAdd, onEdit, onDelete, onMove, onDropReorder, onDropMove }: {
  nodes: BookmarkTreeNode[]
  depth: number
  parentId: number | null
  canWrite: boolean
  onAdd: (parentId: number) => void
  onEdit: (node: BookmarkTreeNode) => void
  onDelete: (node: BookmarkTreeNode) => void
  onMove: (siblings: BookmarkTreeNode[], index: number, direction: -1 | 1) => void
  onDropReorder: (parentId: number | null, ids: number[]) => void
  onDropMove: (id: number, parentId: number | null) => void
}) {
  const { t } = useTranslation()
  // Folders start collapsed; the user expands the ones they want to inspect.
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => new Set(nodes.filter((node) => node.node_type === 'folder' && node.children.length > 0).map((node) => node.id)),
  )
  // Drop position indicator: 'before' | 'after' a node index, or null.
  const [dropTarget, setDropTarget] = useState<{ index: number; pos: 'before' | 'after' } | null>(null)
  // Folder highlighted as a move-into target.
  const [dropFolder, setDropFolder] = useState<number | null>(null)

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleDragStart = (e: React.DragEvent, id: number) => {
    if (!canWrite) return
    draggedNodeId = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
  }
  const handleDragEnd = () => {
    draggedNodeId = null
    setDropTarget(null)
    setDropFolder(null)
  }

  // Dropping onto a row: determine before/after based on cursor Y vs midpoint.
  const handleRowDragOver = (e: React.DragEvent, index: number) => {
    if (!canWrite || draggedNodeId === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget({ index, pos })
    setDropFolder(null)
  }
  const handleRowDrop = (e: React.DragEvent, index: number) => {
    if (!canWrite || draggedNodeId === null) return
    e.preventDefault()
    const target = nodes[index]
    const dragged = draggedNodeId
    setDropTarget(null)
    setDropFolder(null)
    if (dragged === null || dragged === target.id) return

    // If dropping onto a folder row, move into the folder instead of reordering.
    if (target.node_type === 'folder' && dropTarget?.pos === 'after' && e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height * 0.65) {
      onDropMove(dragged, target.id)
      return
    }

    const ids = nodes.map((n) => n.id).filter((id) => id !== dragged)
    const draggedStillSibling = nodes.some((n) => n.id === dragged)
    let insertAt: number
    if (dropTarget) {
      insertAt = dropTarget.pos === 'before' ? index : index + 1
    } else {
      insertAt = index
    }
    // If the dragged node was before the insertion point in this list, removing
    // it shifts the target index down by one.
    if (draggedStillSibling && index < insertAt) insertAt -= 1
    if (insertAt < 0) insertAt = 0
    if (insertAt > ids.length) insertAt = ids.length
    ids.splice(insertAt, 0, dragged)

    // Same parent → reorder; different parent → move then reorder.
    const draggedNode = nodes.find((n) => n.id === dragged)
    if (draggedNode && draggedNode.parent_id === parentId) {
      onDropReorder(parentId, ids)
    } else {
      onDropMove(dragged, parentId)
      // After the move the node lands at the end; a follow-up reorder would be
      // ideal but the tree refresh re-renders, so we keep it simple.
    }
  }

  // Dropping onto a folder header (when collapsed) → move into folder.
  const handleFolderDragOver = (e: React.DragEvent, id: number) => {
    if (!canWrite || draggedNodeId === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropFolder(id)
    setDropTarget(null)
  }
  const handleFolderDrop = (e: React.DragEvent, id: number) => {
    if (!canWrite || draggedNodeId === null) return
    e.preventDefault()
    setDropFolder(null)
    if (draggedNodeId !== null && draggedNodeId !== id) onDropMove(draggedNodeId, id)
  }

  return (
    <div className="tree-level" role="group">
      {nodes.map((node, index) => {
        const isFolder = node.node_type === 'folder'
        const hasChildren = node.children.length > 0
        const isCollapsed = collapsed.has(node.id)
        const isDropBefore = dropTarget?.index === index && dropTarget?.pos === 'before'
        const isDropAfter = dropTarget?.index === index && dropTarget?.pos === 'after'
        const isDropFolder = dropFolder === node.id
        return (
          <div className="tree-branch" key={node.id}>
            {isDropBefore && <div className="tree-drop-line" />}
            <div
              className={`tree-row tree-row-${node.node_type}${isDropFolder ? ' tree-row-drop-target' : ''}`}
              style={{ '--tree-depth': depth } as CSSProperties}
              role="treeitem"
              aria-expanded={isFolder ? !isCollapsed : undefined}
              draggable={canWrite}
              onDragStart={(e) => handleDragStart(e, node.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleRowDragOver(e, index)}
              onDrop={(e) => handleRowDrop(e, index)}
            >
              <span className="tree-index">{String(index + 1).padStart(2, '0')}</span>
              {isFolder && hasChildren ? (
                <button
                  type="button"
                  className="tree-toggle"
                  onClick={() => toggle(node.id)}
                  onDragOver={(e) => handleFolderDragOver(e, node.id)}
                  onDrop={(e) => handleFolderDrop(e, node.id)}
                  aria-label={isCollapsed ? t('tree.expand') : t('tree.collapse')}
                  title={isCollapsed ? t('tree.expand') : t('tree.collapse')}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span
                  className="tree-glyph"
                  aria-hidden="true"
                  onDragOver={isFolder ? (e) => handleFolderDragOver(e, node.id) : undefined}
                  onDrop={isFolder ? (e) => handleFolderDrop(e, node.id) : undefined}
                >
                  {isFolder ? '⌑' : node.node_type === 'bookmark' ? '↗' : '—'}
                </span>
              )}
              <div className="tree-node-copy">
                {node.node_type === 'bookmark' && node.url ? (
                  <a href={node.url} target="_blank" rel="noreferrer" className="tree-node-title">{node.title || node.url}</a>
                ) : (
                  <span className="tree-node-title">{node.title || t('tree.separator')}</span>
                )}
                {node.node_type === 'bookmark' && <span className="tree-node-url">{node.url}</span>}
                {node.tags.length > 0 && (
                  <span className="tree-node-tags">{node.tags.map((tag) => `#${tag}`).join(' ')}</span>
                )}
              </div>
              {canWrite && (
                <div className="tree-row-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => onMove(nodes, index, -1)} disabled={index === 0} aria-label={t('tree.move_up')}>↑</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => onMove(nodes, index, 1)} disabled={index === nodes.length - 1} aria-label={t('tree.move_down')}>↓</button>
                  {isFolder && <button className="btn btn-sm btn-ghost" onClick={() => onAdd(node.id)}>＋</button>}
                  {node.node_type !== 'separator' && <button className="btn btn-sm btn-ghost" onClick={() => onEdit(node)}>{t('common.edit')}</button>}
                  <button className="btn btn-sm btn-ghost tree-danger" onClick={() => onDelete(node)}>{t('common.delete')}</button>
                </div>
              )}
            </div>
            {isFolder && hasChildren && !isCollapsed && (
              <TreeLevel
                nodes={node.children}
                depth={depth + 1}
                parentId={node.id}
                canWrite={canWrite}
                onAdd={onAdd}
                onEdit={onEdit}
                onDelete={onDelete}
                onMove={onMove}
                onDropReorder={onDropReorder}
                onDropMove={onDropMove}
              />
            )}
            {isDropAfter && <div className="tree-drop-line" />}
          </div>
        )
      })}
    </div>
  )
}

function NodeForm({ documentId, state, folders, onDone }: {
  documentId: number
  state: EditorState
  folders: BookmarkTreeNode[]
  onDone: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { showError, element } = useToast()
  const node = state.node
  const [nodeType, setNodeType] = useState<BookmarkNodeType>(node?.node_type || 'bookmark')
  const [parentId, setParentId] = useState<number | null>(state.parentId)
  const [title, setTitle] = useState(node?.title || '')
  const [url, setUrl] = useState(node?.url || '')
  const [description, setDescription] = useState(node?.description || '')
  const [tags, setTags] = useState(node?.tags.join(', ') || '')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const data = {
        parent_id: parentId,
        title,
        url: nodeType === 'bookmark' ? url : null,
        description,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      }
      if (state.mode === 'edit' && node) await api.updateNode(node.id, data)
      else await api.createNode({ document_id: documentId, node_type: nodeType, ...data })
      await onDone()
    } catch (error) {
      showError(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="tree-form">
      {state.mode === 'create' && (
        <label><span className="label">{t('tree.type')}</span><select className="input" value={nodeType} onChange={(event) => setNodeType(event.target.value as BookmarkNodeType)}>
          <option value="bookmark">{t('tree.bookmark')}</option>
          <option value="folder">{t('tree.folder')}</option>
          <option value="separator">{t('tree.separator')}</option>
        </select></label>
      )}
      {nodeType !== 'separator' && <label><span className="label">{t('tree.name')}</span><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
      {nodeType === 'bookmark' && <label><span className="label">URL</span><input className="input" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} /></label>}
      <label><span className="label">{t('tree.parent')}</span><select className="input" value={parentId ?? ''} onChange={(event) => setParentId(event.target.value ? Number(event.target.value) : null)}>
        <option value="">{t('tree.root')}</option>
        {folders.filter((folder) => folder.id !== node?.id).map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}
      </select></label>
      {nodeType !== 'separator' && <label><span className="label">{t('tree.description')}</span><textarea className="input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>}
      {nodeType === 'bookmark' && <label><span className="label">{t('tree.tags')}</span><input className="input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="work, reference" /></label>}
      <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? t('common.loading') : t('common.save')}</button>
      {element}
    </form>
  )
}

function collectFolders(nodes: BookmarkTreeNode[]): BookmarkTreeNode[] {
  return nodes.flatMap((node) => [
    ...(node.node_type === 'folder' ? [node] : []),
    ...collectFolders(node.children),
  ])
}

function countNodes(nodes: BookmarkTreeNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0)
}
