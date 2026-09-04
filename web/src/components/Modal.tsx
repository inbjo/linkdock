import { useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          maxWidth: '90vw',
          width: '32rem',
          maxHeight: '85vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
            paddingBottom: '0.75rem',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>{title}</h2>
          <button
            className="btn btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div>{children}</div>
        {footer && (
          <div
            style={{
              marginTop: '1rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
