import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SettingsBar } from '@/components/SettingsBar'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { showError, showSuccess, element } = useToast()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const token = params.get('token') || ''

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return showError(t('auth.password_too_short'))
    setLoading(true)
    try {
      await api.resetPassword(token, password)
      showSuccess(t('auth.password_reset_success'))
      navigate('/login')
    } catch (err) {
      showError(err instanceof Error ? err.message : t('auth.invalid_reset_link'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell auth-centered">
      {element}<SettingsBar />
      <main className="card auth-recovery-card">
        <div className="section-label">{t('auth.account_recovery')}</div>
        <h1 className="font-display">{t('auth.choose_new_password')}</h1>
        {token ? (
          <form onSubmit={submit} className="auth-recovery-form">
            <div>
              <label className="label" htmlFor="reset-password">{t('auth.new_password')}</label>
              <input id="reset-password" className="input" type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? t('common.loading') : t('auth.reset_password')}</button>
          </form>
        ) : <div className="card-flat auth-recovery-message">{t('auth.invalid_reset_link')}</div>}
        <Link to="/login" className="auth-back-link">← {t('auth.back_to_login')}</Link>
      </main>
    </div>
  )
}
