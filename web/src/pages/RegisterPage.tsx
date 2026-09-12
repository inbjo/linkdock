import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { SettingsBar } from '@/components/SettingsBar'

export function RegisterPage() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { showError, showSuccess } = useToast()
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [isFirstUser, setIsFirstUser] = useState(false)
  const [requiresSetupToken, setRequiresSetupToken] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.setupStatus()
      .then((status) => {
        setIsFirstUser(!status.initialized)
        setRequiresSetupToken(status.requires_setup_token)
      })
      .catch(() => undefined)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      showError(t('auth.password_too_short'))
      return
    }
    setLoading(true)
    try {
      await api.register(username, email, password, displayName, setupToken || undefined)
      await refresh()
      showSuccess(t('auth.register_success'))
      nav('/bookmarks')
    } catch (err) {
      showError(err instanceof Error ? err.message : t('auth.register'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page min-h-dvh w-full overflow-x-clip flex flex-col items-center justify-center px-6 py-12 relative">
      <SettingsBar />

      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Wordmark */}
        <Link to="/" className="font-display text-2xl font-semibold tracking-tight text-[var(--color-ink)] no-underline mb-12 select-none">
          {t('app.name')}
        </Link>

        {/* Form */}
        <form onSubmit={submit} className="w-full flex flex-col gap-4">
          {isFirstUser && (
            <div className="w-full px-4 py-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-2)] text-sm text-[var(--color-ink-2)] leading-relaxed">
              {t('auth.first_user_admin')}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
              {t('auth.username')}
            </label>
            <input
              className="auth-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              minLength={2}
              autoComplete="username"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
              {t('auth.email')}
            </label>
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
              {t('auth.password')}
            </label>
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
              {t('auth.display_name')}
            </label>
            <input
              className="auth-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </div>
          {requiresSetupToken && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
                {t('auth.setup_token')}
              </label>
              <input
                className="auth-input"
                type="password"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                required
                autoComplete="one-time-code"
              />
              <p className="text-xs text-[var(--color-ink-3)] leading-relaxed mt-0.5">
                {t('auth.setup_token_hint')}
              </p>
            </div>
          )}
          <button
            className="auth-btn-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? t('common.loading') : t('auth.register')}
          </button>
        </form>

        {/* Login link */}
        <p className="mt-10 text-sm text-[var(--color-ink-2)] text-center">
          {t('auth.have_account')}{' '}
          <Link to="/login" className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors duration-150 no-underline">
            {t('auth.login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
