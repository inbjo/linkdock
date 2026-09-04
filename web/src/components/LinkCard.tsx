import type { LinkWithTags } from '@/lib/types'

interface LinkCardProps {
  link: LinkWithTags
  selected: boolean
  onSelect: (id: number, selected: boolean) => void
  onClick: (link: LinkWithTags) => void
}

export function LinkCard({ link, selected, onSelect, onClick }: LinkCardProps) {
  let domain = ''
  try {
    domain = new URL(link.url).hostname
  } catch {
    domain = link.url
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        padding: '0.75rem',
        border: '1px solid var(--color-border)',
        borderRadius: '0.375rem',
        background: 'var(--color-bg)',
        cursor: 'pointer',
        borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
      }}
      onClick={() => onClick(link)}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => {
          e.stopPropagation()
          onSelect(link.id, e.target.checked)
        }}
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: '0.125rem', flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {link.name || domain}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {domain}
        </div>
        {link.description && (
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {link.description}
          </div>
        )}
        {link.tags.length > 0 && (
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
            {link.tags.map((tag) => (
              <span key={tag} className="badge">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
