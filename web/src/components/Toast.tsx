import { useEffect, useState } from 'react'

export function Toast({ message, type, onClose }: { message: string; type: 'error' | 'success'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  const color = type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
  return (
    <div
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        zIndex: 100,
        padding: '0.75rem 1rem',
        borderRadius: '0.375rem',
        background: 'var(--color-bg)',
        border: `1px solid ${color}`,
        borderLeft: `4px solid ${color}`,
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        maxWidth: '24rem',
      }}
    >
      {message}
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
