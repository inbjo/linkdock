import { useState } from 'react'
import type { CollectionNode } from '@/lib/types'

interface CollectionTreeProps {
  nodes: CollectionNode[]
  selectedId?: number | null
  onSelect: (id: number | null) => void
  onDelete?: (id: number) => void
  onRename?: (id: number) => void
}

export function CollectionTree({ nodes, selectedId, onSelect, onDelete, onRename }: CollectionTreeProps) {
  return (
    <div className="scrollbar-thin" style={{ overflowY: 'auto' }}>
      <TreeItem
        node={null}
        level={0}
        selectedId={selectedId}
        onSelect={onSelect}
        children={nodes}
        onDelete={onDelete}
        onRename={onRename}
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
  onDelete?: (id: number) => void
  onRename?: (id: number) => void
}

function TreeItem({ node, level, selectedId, onSelect, children, onDelete, onRename }: TreeItemProps) {
  const [expanded, setExpanded] = useState(true)
  const [showActions, setShowActions] = useState(false)
  const isSelected = node ? selectedId === node.id : selectedId === null || selectedId === undefined

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2xs)',
          padding: 'var(--space-3xs) var(--space-2xs)',
          paddingLeft: `calc(var(--space-2xs) + ${level * 0.75}rem)`,
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          background: isSelected && level > 0 ? 'var(--color-accent-subtle)' : 'transparent',
          fontSize: 'var(--text-sm)',
          color: isSelected && level > 0 ? 'var(--color-accent)' : 'var(--color-ink-2)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'background var(--dur-short) var(--ease-out), color var(--dur-short) var(--ease-out)',
        }}
        onMouseEnter={(e) => {
          if (!isSelected || level === 0) e.currentTarget.style.background = 'var(--color-paper-3)'
          if (node) setShowActions(true)
        }}
        onMouseLeave={(e) => {
          if (!isSelected || level === 0) e.currentTarget.style.background = 'transparent'
          setShowActions(false)
        }}
        onClick={() => onSelect(node?.id ?? null)}
      >
        {children.length > 0 ? (
          <span
            style={{
              width: '0.875rem',
              textAlign: 'center',
              flexShrink: 0,
              userSelect: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-ink-3)',
            }}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? '−' : '+'}
          </span>
        ) : (
          <span style={{ width: '0.875rem', flexShrink: 0 }} />
        )}
        <span style={{ flexShrink: 0, fontSize: '0.75rem' }}>
          {node ? '▸' : '◎'}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
          {node ? node.name : 'All'}
        </span>
        {node && showActions && (onDelete || onRename) && (
          <span style={{ display: 'flex', gap: 'var(--space-3xs)', flexShrink: 0 }}>
            {onRename && (
              <button
                className="btn btn-icon btn-sm"
                style={{ padding: '0.125rem', width: '1.25rem', height: '1.25rem' }}
                title="Rename"
                onClick={(e) => { e.stopPropagation(); onRename(node.id) }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 7.5L7 1.5l1.5 1.5L2.5 9H1V7.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                className="btn btn-icon btn-sm"
                style={{ padding: '0.125rem', width: '1.25rem', height: '1.25rem', color: 'var(--color-danger)' }}
                title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete(node.id) }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 3h7M3.5 3V2h3v1M2.5 3l.5 5.5h4L7.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </span>
        )}
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
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
    </div>
  )
}
