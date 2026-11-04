import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'

export function ProfilePage() {
  const { t } = useTranslation()
  const { me, refresh } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  useEffect(() => {
    setEmail(me?.email || '')
    setDisplayName(me?.display_name || '')
  }, [me?.email, me?.display_name])
  if (!me) return null

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setSavingProfile(true)
    try {
      await api.updateProfile(email, displayName)
      await refresh()
      showSuccess(t('profile.saved'))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('profile.save'))
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (newPassword.length < 8) return showError(t('auth.password_too_short'))
    if (newPassword !== confirmPassword) return showError(t('profile.password_mismatch'))
    setChangingPassword(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showSuccess(t('profile.password_changed'))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('profile.change_password'))
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div className="page-shell scrollbar-thin">
      {element}
      <div className="page-container-narrow mx-auto">
        <div className="page-eyebrow">{t('settings.profile')}</div>
        <h1 className="font-display page-title">{t('profile.title')}</h1>

        {/* Account info */}
        <div className="card profile-info-card">
          <div className="profile-info-row">
            <span className="label">{t('auth.username')}</span>
            <span className="profile-info-value">{me.username}</span>
          </div>
        </div>

        {/* Profile form */}
        <form className="card profile-form" onSubmit={saveProfile}>
          <div>
            <label className="label" htmlFor="profile-email">{t('auth.email')}</label>
            <input id="profile-email" className="input" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="profile-display-name">{t('auth.display_name')}</label>
            <input id="profile-display-name" className="input" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={savingProfile}>
            {savingProfile ? t('common.loading') : t('profile.save')}
          </button>
        </form>

        {/* Password */}
        <section className="profile-section">
          <div className="page-eyebrow">{t('passkeys.security')}</div>
          <h2 className="font-display page-subtitle">{t('profile.password_title')}</h2>
          <p className="profile-section-desc">{t('profile.password_description')}</p>
          <form className="card profile-form" onSubmit={changePassword}>
            <div>
              <label className="label" htmlFor="current-password">{t('profile.current_password')}</label>
              <input id="current-password" className="input" type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </div>
            <div className="profile-password-grid">
              <div>
                <label className="label" htmlFor="new-password">{t('profile.new_password')}</label>
                <input id="new-password" className="input" type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="confirm-password">{t('profile.confirm_password')}</label>
                <input id="confirm-password" className="input" type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={changingPassword}>
              {changingPassword ? t('common.loading') : t('profile.change_password')}
            </button>
          </form>
        </section>

      </div>
    </div>
  )
}
