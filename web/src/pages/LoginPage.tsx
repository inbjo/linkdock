import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { SettingsBar } from '@/components/SettingsBar'

export function LoginPage() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { showError, showSuccess, element } = useToast()
  const { refresh } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.login(identifier, password)
      await refresh()
      showSuccess(t('auth.login_success'))
      nav('/bookmarks')
    } catch (err) {
      showError(err instanceof Error ? err.message : t('auth.login'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page min-h-dvh w-full overflow-x-clip flex flex-col items-center justify-center px-6 py-12 relative">
      {element}
      <SettingsBar />

      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Wordmark */}
        <Link to="/" className="auth-wordmark-link font-display text-2xl font-semibold tracking-tight text-[var(--color-ink)] no-underline mb-12 select-none">
          {t('app.name')}
        </Link>

        {/* Form */}
        <form onSubmit={submit} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
              {t('auth.username_or_email')}
            </label>
            <input
              className="auth-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoFocus
              required
              autoComplete="username"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
                {t('auth.password')}
              </label>

            </div>
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <button
            className="auth-btn-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? t('common.loading') : t('auth.login')}
          </button>
        </form>

        {/* Register link */}
        <p className="mt-10 text-sm text-[var(--color-ink-2)] text-center">
          {t('auth.no_account')}{' '}
          <Link to="/register" className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors duration-150 no-underline">
            {t('auth.register')}
          </Link>
        </p>
      </div>
    </div>
  )
}
