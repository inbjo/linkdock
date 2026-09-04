import { useState } from 'react'
import type { CollectionNode } from '@/lib/types'

interface CollectionTreeProps {
  nodes: CollectionNode[]
  selectedId?: number | null
  onSelect: (id: number | null) => void
  onContextMenu?: (e: React.MouseEvent, node: CollectionNode) => void
}

export function CollectionTree({ nodes, selectedId, onSelect, onContextMenu }: CollectionTreeProps) {
  return (
    <div className="scrollbar-thin" style={{ overflowY: 'auto' }}>
      <TreeItem
        node={null}
        level={0}
        selectedId={selectedId}
        onSelect={onSelect}
        children={nodes}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}

interface TreeItemProps {
  node: CollectionNode | null
  level: number
  selectedId?: number | null
  onSelect: (id: number | null) => void
  children: CollectionNode[]
  onContextMenu?: (e: React.MouseEvent, node: CollectionNode) => void
}

function TreeItem({ node, level, selectedId, onSelect, children, onContextMenu }: TreeItemProps) {
  const [expanded, setExpanded] = useState(true)
  const isSelected = node ? selectedId === node.id : selectedId === null || selectedId === undefined

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.25rem 0.5rem',
          paddingLeft: `${0.5 + level * 1}rem`,
          cursor: 'pointer',
          borderRadius: '0.25rem',
          background: isSelected && level > 0 ? 'var(--color-bg-tertiary)' : 'transparent',
          fontSize: '0.8125rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onClick={() => onSelect(node?.id ?? null)}
        onContextMenu={(e) => {
          if (node && onContextMenu) {
            e.preventDefault()
            onContextMenu(e, node)
          }
        }}
      >
        {children.length > 0 ? (
          <span
            style={{ width: '1rem', textAlign: 'center', flexShrink: 0, userSelect: 'none' }}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span style={{ width: '1rem', flexShrink: 0 }} />
        )}
        <span style={{ flexShrink: 0 }}>{node ? '📁' : '🏠'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node ? node.name : 'All Bookmarks'}
        </span>
      </div>
      {expanded &&
        children.map((child) => (
          <TreeItem
            key={child.id}
            node={child}
            level={level + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            children={child.children}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  )
}
