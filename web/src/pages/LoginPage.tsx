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
  const { showError, showSuccess } = useToast()
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

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

  return (
    <div style={{ maxWidth: '24rem', margin: '4rem auto', padding: '0 1rem' }}>
      <SettingsBar />
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>{t('auth.login_title')}</h1>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label className="label">{t('auth.username')}</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </div>
        <div>
          <label className="label">{t('auth.password')}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? t('common.loading') : t('auth.login')}
        </button>
      </form>
      <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
        {t('auth.no_account')} <Link to="/register">{t('auth.register')}</Link>
      </p>
    </div>
  )
}
