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
    <div className="auth-page min-h-dvh w-full overflow-x-clip flex flex-col items-center justify-center px-6 py-12 relative">
      <SettingsBar />

      <div className="w-full max-w-sm flex flex-col items-center">
        <Link to="/" className="font-display text-2xl font-semibold tracking-tight text-[var(--color-ink)] no-underline mb-12 select-none">
          {t('app.name')}
        </Link>

        <div className="w-full mb-8">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-ink)] leading-tight">
            {t('auth.forgot_password')}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-2)] leading-relaxed">
            {t('auth.forgot_password_hint')}
          </p>
        </div>

        {sent ? (
          <div className="w-full px-4 py-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-2)] text-sm text-[var(--color-ink-2)] leading-relaxed">
            {t('auth.reset_email_sent')}
          </div>
        ) : (
          <form onSubmit={submit} className="w-full flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide" htmlFor="forgot-email">
                {t('auth.email')}
              </label>
              <input
                id="forgot-email"
                className="auth-input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            <button className="auth-btn-primary" type="submit" disabled={loading}>
              {loading ? t('common.loading') : t('auth.send_reset_link')}
            </button>
          </form>
        )}

        <p className="mt-8 text-sm text-[var(--color-ink-2)] text-center">
          <Link to="/login" className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors duration-150 no-underline">
            ← {t('auth.back_to_login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
