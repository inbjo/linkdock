import type { LinkWithTags } from '@/lib/types'

interface LinkCardProps {
  link: LinkWithTags
  selected: boolean
  onSelect: (id: number, selected: boolean) => void
  onClick: (link: LinkWithTags) => void
  readOnly?: boolean
}

export function LinkCard({ link, selected, onSelect, onClick, readOnly = false }: LinkCardProps) {
  let domain = ''
  let favicon = ''
  try {
    const url = new URL(link.url)
    domain = url.hostname
    favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  } catch {
    domain = link.url
  }

  return (
    <div
      className={`link-card${selected ? ' is-selected' : ''}`}
      style={{
        display: 'flex',
        gap: 'var(--space-xs)',
        padding: 'var(--space-sm)',
        border: '1px solid var(--color-rule)',
        borderRadius: 'var(--radius)',
        background: 'var(--color-paper)',
        cursor: readOnly ? 'default' : 'pointer',
        borderColor: selected ? 'var(--color-accent)' : 'var(--color-rule)',
        boxShadow: selected ? '0 0 0 1px var(--color-accent)' : 'none',
        transition: 'border-color var(--dur-short) var(--ease-out), box-shadow var(--dur-short) var(--ease-out)',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = 'var(--color-rule-strong)' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = 'var(--color-rule)' }}
      onClick={() => { if (!readOnly) onClick(link) }}
    >
      {!readOnly && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation()
            onSelect(link.id, e.target.checked)
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ marginTop: '0.125rem', flexShrink: 0, accentColor: 'var(--color-accent)' }}
        />
      )}
      {favicon && (
        <img
          src={favicon}
          alt=""
          width={16}
          height={16}
          style={{
            flexShrink: 0,
            marginTop: '0.125rem',
            width: '1rem',
            height: '1rem',
            objectFit: 'contain',
            borderRadius: 'var(--radius-sm)',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="font-display"
          style={{
            fontWeight: 500,
            fontSize: 'var(--text-sm)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--color-ink)',
          }}
        >
          {link.name || domain}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-ink-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 'var(--space-3xs)',
          }}
        >
          {domain}
        </div>
        {link.description && (
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-ink-2)',
              marginTop: 'var(--space-2xs)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {link.description}
          </div>
        )}
        {link.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-3xs)', flexWrap: 'wrap', marginTop: 'var(--space-2xs)' }}>
            {link.tags.map((tag) => (
              <span key={tag} className="badge">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
