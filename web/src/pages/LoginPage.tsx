import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { SettingsBar } from '@/components/SettingsBar'
import { getPasskey, isPasskeySupported } from '@/lib/webauthn'

export function LoginPage() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { showError, showSuccess, element } = useToast()
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.login(username, password)
      await refresh()
      showSuccess(t('auth.login_success'))
      nav('/bookmarks')
    } catch (err) {
      showError(err instanceof Error ? err.message : t('auth.login'))
    } finally {
      setLoading(false)
    }
  }

  const loginWithPasskey = async (legacyUsername?: string) => {
    setPasskeyLoading(true)
    try {
      const challenge = await api.startPasskeyLogin(legacyUsername)
      const credential = await getPasskey(challenge.options)
      await api.finishPasskeyLogin(challenge.flow_id, credential)
      await refresh()
      showSuccess(t('auth.login_success'))
      nav('/bookmarks')
    } catch (err) {
      showError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? t('auth.passkey_cancelled')
          : err instanceof Error
            ? err.message
            : t('auth.passkey_login'),
      )
    } finally {
      setPasskeyLoading(false)
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
              {t('auth.username')}
            </label>
            <input
              className="auth-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              autoComplete="username webauthn"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide">
                {t('auth.password')}
              </label>
              <Link to="/forgot-password" className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors duration-150 no-underline font-medium">
                {t('auth.forgot_password')}
              </Link>
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

        {/* Divider */}
        <div className="w-full flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[var(--color-rule)]" />
          <span className="text-xs text-[var(--color-ink-3)] font-mono uppercase tracking-wider">{t('auth.or')}</span>
          <div className="flex-1 h-px bg-[var(--color-rule)]" />
        </div>

        {/* Passkey */}
        <button
          className="auth-btn-passkey w-full"
          type="button"
          disabled={passkeyLoading || !isPasskeySupported()}
          onClick={() => loginWithPasskey()}
        >
          <span aria-hidden="true" className="text-base leading-none">⌁</span>
          {passkeyLoading ? t('common.loading') : t('auth.passkey_login')}
        </button>
        {!isPasskeySupported() ? (
          <p className="mt-3 text-xs text-[var(--color-ink-3)] text-center leading-relaxed">{t('auth.passkey_unsupported')}</p>
        ) : null}
        {isPasskeySupported() && username.trim() ? (
          <button
            type="button"
            className="auth-btn-ghost w-full mt-2"
            disabled={passkeyLoading}
            onClick={() => loginWithPasskey(username.trim())}
          >
            {t('auth.passkey_username_fallback')}
          </button>
        ) : null}

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
