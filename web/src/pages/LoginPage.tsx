import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { SettingsBar } from '@/components/SettingsBar'
import { getPasskey, isPasskeySupported } from '@/lib/webauthn'
import { AuthScene } from '@/components/AuthScene'

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
    <div className="auth-shell" style={{ display: 'flex', minHeight: '100vh', overflow: 'hidden' }}>
      {element}
      <SettingsBar />

      {/* Left: brand panel */}
      <div
        className="auth-brand-panel"
        style={{
          flex: '1 1 50%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 'var(--space-2xl)',
          background: 'var(--color-paper-2)',
          borderRight: '1px solid var(--color-rule)',
        }}
      >
        <div className="auth-brand-copy" style={{ maxWidth: '28rem' }}>
          <div
            className="font-display auth-wordmark"
            style={{
              fontSize: 'var(--text-display)',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              color: 'var(--color-ink)',
            }}
          >
            {t('app.name')}
          </div>
          <div className="auth-tagline"
            style={{
              marginTop: 'var(--space-md)',
              fontSize: 'var(--text-md)',
              color: 'var(--color-ink-2)',
              lineHeight: 1.6,
              maxWidth: '24rem',
            }}
          >
            {t('sync.intro')}
          </div>
          <div
            className="font-mono auth-proof"
            style={{
              marginTop: 'var(--space-xl)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-ink-3)',
              letterSpacing: '0.04em',
            }}
          >
            Floccus-compatible · Self-hosted · Open source
          </div>
        </div>
        <AuthScene />
      </div>

      {/* Right: form */}
      <div className="auth-form-panel"
        style={{
          flex: '1 1 50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-xl)',
        }}
      >
        <div className="auth-form-card mx-auto w-full" style={{ width: '100%', maxWidth: '22rem' }}>
          <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
            {t('auth.login')}
          </div>
          <h1
            className="font-display"
            style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-lg)' }}
          >
            {t('auth.login_title')}
          </h1>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div>
              <label className="label">{t('auth.username')}</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                autoComplete="username webauthn"
              />
            </div>
            <div>
              <label className="label">{t('auth.password')}</label>
              <Link to="/forgot-password" className="auth-forgot-link">{t('auth.forgot_password')}</Link>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
              {loading ? t('common.loading') : t('auth.login')}
            </button>
          </form>
          <div className="auth-divider"><span>{t('auth.or')}</span></div>
          <button
            className="btn passkey-button"
            type="button"
            disabled={passkeyLoading || !isPasskeySupported()}
            onClick={() => loginWithPasskey()}
            style={{ width: '100%' }}
          >
            <span aria-hidden="true" className="passkey-icon">⌁</span>
            {passkeyLoading ? t('common.loading') : t('auth.passkey_login')}
          </button>
          {!isPasskeySupported() ? (
            <p className="passkey-hint">{t('auth.passkey_unsupported')}</p>
          ) : null}
          {isPasskeySupported() && username.trim() ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={passkeyLoading}
              onClick={() => loginWithPasskey(username.trim())}
              style={{ width: '100%', marginTop: 'var(--space-xs)', justifyContent: 'center' }}
            >
              {t('auth.passkey_username_fallback')}
            </button>
          ) : null}
          <p style={{ marginTop: 'var(--space-lg)', fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)' }}>
            {t('auth.no_account')}{' '}
            <Link to="/register" style={{ fontWeight: 500 }}>{t('auth.register')}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
