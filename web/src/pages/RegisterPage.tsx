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
    <div style={{ display: 'flex', minHeight: '100vh', overflow: 'hidden' }}>
      <SettingsBar />

      {/* Left: brand panel */}
      <div
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
        <div style={{ maxWidth: '28rem' }}>
          <div
            className="font-display"
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
          <div
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
            className="font-mono"
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
      </div>

      {/* Right: form */}
      <div
        style={{
          flex: '1 1 50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-xl)',
        }}
      >
        <div style={{ width: '100%', maxWidth: '22rem' }}>
          <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
            {t('auth.register')}
          </div>
          <h1
            className="font-display"
            style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-lg)' }}
          >
            {t('auth.register_title')}
          </h1>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {isFirstUser && (
              <div className="card-flat" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.55, color: 'var(--color-ink-2)' }}>
                {t('auth.first_user_admin')}
              </div>
            )}
            <div>
              <label className="label">{t('auth.username')}</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                minLength={2}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="label">{t('auth.email')}</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">{t('auth.password')}</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">{t('auth.display_name')}</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
            {requiresSetupToken && (
              <div>
                <label className="label">{t('auth.setup_token')}</label>
                <input
                  className="input"
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  required
                  autoComplete="one-time-code"
                />
                <div style={{ marginTop: 'var(--space-3xs)', color: 'var(--color-ink-3)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
                  {t('auth.setup_token_hint')}
                </div>
              </div>
            )}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
              {loading ? t('common.loading') : t('auth.register')}
            </button>
          </form>
          <p style={{ marginTop: 'var(--space-lg)', fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)' }}>
            {t('auth.have_account')}{' '}
            <Link to="/login" style={{ fontWeight: 500 }}>{t('auth.login')}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
