export function AuthScene() {
  return (
    <div className="auth-scene" aria-hidden="true">
      <div className="auth-scene-rail auth-scene-rail-a">
        <BookmarkTile glyph="L" label="Launch notes" meta="work / today" />
        <BookmarkTile glyph="R" label="Reading queue" meta="12 saved" />
        <BookmarkTile glyph="D" label="Design systems" meta="reference" />
      </div>
      <div className="auth-scene-rail auth-scene-rail-b">
        <BookmarkTile glyph="⌁" label="Synced everywhere" meta="just now" />
        <BookmarkTile glyph="P" label="Private archive" meta="personal" />
        <BookmarkTile glyph="F" label="Floccus" meta="connected" />
      </div>
      <div className="auth-scene-status"><span /> end-to-end bookmark sync</div>
    </div>
  )
}

function BookmarkTile({ glyph, label, meta }: { glyph: string; label: string; meta: string }) {
  return (
    <div className="auth-bookmark-tile">
      <span className="auth-bookmark-icon">{glyph}</span>
      <span><strong>{label}</strong><small>{meta}</small></span>
      <span className="auth-bookmark-arrow">↗</span>
    </div>
  )
}
