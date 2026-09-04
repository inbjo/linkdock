import { useEffect, useState } from 'react'

export function Toast({ message, type, onClose }: { message: string; type: 'error' | 'success'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  const isError = type === 'error'
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'var(--space-md)',
        right: 'var(--space-md)',
        zIndex: 100,
        padding: 'var(--space-xs) var(--space-md)',
        borderRadius: 'var(--radius)',
        background: 'var(--color-paper)',
        border: '1px solid var(--color-rule)',
        borderLeft: `3px solid ${isError ? 'var(--color-danger)' : 'var(--color-accent)'}`,
        boxShadow: 'var(--shadow-lg)',
        maxWidth: '24rem',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-body)',
        color: 'var(--color-ink)',
        animation: 'toast-in var(--dur) var(--ease-out)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2xs)' }}>
        {isError ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--color-danger)' }}>
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 5v3.5M8 11v0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--color-accent)' }}>
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5.5 8l2 2 3-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span>{message}</span>
      </div>
    </div>
  )
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null)
  const showError = (msg: string) => setToast({ message: msg, type: 'error' })
  const showSuccess = (msg: string) => setToast({ message: msg, type: 'success' })
  const element = toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null
  return { showError, showSuccess, element }
}
