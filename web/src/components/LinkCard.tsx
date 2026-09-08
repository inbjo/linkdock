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
      style={{ cursor: readOnly ? 'default' : 'pointer' }}
      onClick={() => { if (!readOnly) onClick(link) }}
    >
      {!readOnly && (
        <label className="checkbox-hit link-card-checkbox" onClick={(e) => e.stopPropagation()}>
          <span className="sr-only">{link.name || domain}</span>
          <input
            className="ui-checkbox"
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(link.id, e.target.checked)}
            aria-label={link.name || domain}
          />
          <span className="ui-checkbox-mark" aria-hidden="true" />
        </label>
      )}
      {favicon && (
        <img
          src={favicon}
          alt=""
          width={16}
          height={16}
          className="link-card-favicon"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="link-card-body">
        <div
          className="font-display link-card-title"
        >
          {link.name || domain}
        </div>
        <div
          className="link-card-domain"
        >
          {domain}
        </div>
        {link.description && (
          <div
            className="link-card-description"
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
