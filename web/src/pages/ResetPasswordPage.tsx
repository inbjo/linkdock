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
    <div className="auth-page min-h-dvh w-full overflow-x-clip flex flex-col items-center justify-center px-6 py-12 relative">
      {element}
      <SettingsBar />

      <div className="w-full max-w-sm flex flex-col items-center">
        <Link to="/" className="font-display text-2xl font-semibold tracking-tight text-[var(--color-ink)] no-underline mb-12 select-none">
          {t('app.name')}
        </Link>

        <div className="w-full mb-8">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-ink)] leading-tight">
            {t('auth.choose_new_password')}
          </h1>
        </div>

        {token ? (
          <form onSubmit={submit} className="w-full flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-ink-2)] tracking-wide" htmlFor="reset-password">
                {t('auth.new_password')}
              </label>
              <input
                id="reset-password"
                className="auth-input"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </div>
            <button className="auth-btn-primary" type="submit" disabled={loading}>
              {loading ? t('common.loading') : t('auth.reset_password')}
            </button>
          </form>
        ) : (
          <div className="w-full px-4 py-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-2)] text-sm text-[var(--color-ink-2)] leading-relaxed">
            {t('auth.invalid_reset_link')}
          </div>
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
