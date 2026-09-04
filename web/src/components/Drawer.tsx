import { useState, useRef, useEffect } from 'react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string
}

export function Drawer({ open, onClose, title, children, width = '28rem' }: DrawerProps) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setVisible(true)
    else {
      const timer = setTimeout(() => setVisible(false), 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  if (!visible && !open) return null

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          background: 'rgba(0,0,0,0.3)',
          opacity: open ? 1 : 0,
          transition: 'opacity 0.2s',
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
          background: 'var(--color-bg)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-4px 0 6px rgba(0,0,0,0.1)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.2s',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }} className="scrollbar-thin">
          {children}
        </div>
      </div>
    </>
  )
}
