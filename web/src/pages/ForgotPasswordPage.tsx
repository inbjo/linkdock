import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SettingsBar } from '@/components/SettingsBar'
import { api } from '@/lib/api'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    try {
      await api.forgotPassword(email)
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell auth-centered">
      <SettingsBar />
      <main className="card auth-recovery-card">
        <div className="section-label">{t('auth.account_recovery')}</div>
        <h1 className="font-display">{t('auth.forgot_password')}</h1>
        {sent ? (
          <div className="card-flat auth-recovery-message">{t('auth.reset_email_sent')}</div>
        ) : (
          <form onSubmit={submit} className="auth-recovery-form">
            <p>{t('auth.forgot_password_hint')}</p>
            <div>
              <label className="label" htmlFor="forgot-email">{t('auth.email')}</label>
              <input id="forgot-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? t('common.loading') : t('auth.send_reset_link')}</button>
          </form>
        )}
        <Link to="/login" className="auth-back-link">← {t('auth.back_to_login')}</Link>
      </main>
    </div>
  )
}
