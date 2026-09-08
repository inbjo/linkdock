import { useState, useRef, useEffect } from 'react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string
}

export function Drawer({ open, onClose, title, children, width = '30rem' }: DrawerProps) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setVisible(true)
    else {
      const timer = setTimeout(() => setVisible(false), 220)
      return () => clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!visible && !open) return null

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          background: 'var(--color-overlay-soft)',
          opacity: open ? 1 : 0,
          transition: 'opacity var(--dur) var(--ease-out)',
        }}
        onClick={onClose}
      />
      <div
        ref={ref}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: `min(${width}, 100vw)`,
          zIndex: 41,
          background: 'var(--color-paper)',
          borderLeft: '1px solid var(--color-rule)',
          boxShadow: 'var(--shadow-drawer)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform var(--dur) var(--ease-out)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--space-md)',
            borderBottom: '1px solid var(--color-rule)',
            flexShrink: 0,
          }}
        >
          <h2
            className="font-display"
            style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            {title}
          </h2>
          <button className="btn btn-sm btn-icon" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-md)' }} className="scrollbar-thin">
          {children}
        </div>
      </div>
    </>
  )
}
