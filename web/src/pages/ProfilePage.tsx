import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { createPasskey, isPasskeySupported } from '@/lib/webauthn'
import { useToast } from '@/components/Toast'

export function ProfilePage() {
  const { t } = useTranslation()
  const { me, refresh } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const { data: passkeys = [] } = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api.listPasskeys(),
  })
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

  const addPasskey = async (event: React.FormEvent) => {
    event.preventDefault()
    setAdding(true)
    try {
      const challenge = await api.startPasskeyRegistration()
      const credential = await createPasskey(challenge.options)
      await api.finishPasskeyRegistration(
        challenge.flow_id,
        name.trim() || t('passkeys.default_name'),
        credential,
      )
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['passkeys'] })
      showSuccess(t('passkeys.added'))
    } catch (err) {
      showError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? t('passkeys.cancelled')
          : err instanceof Error
            ? err.message
            : t('passkeys.add'),
      )
    } finally {
      setAdding(false)
    }
  }

  const deletePasskey = async (id: number) => {
    if (!confirm(t('passkeys.delete_confirm'))) return
    setDeletingId(id)
    try {
      await api.deletePasskey(id)
      await queryClient.invalidateQueries({ queryKey: ['passkeys'] })
      showSuccess(t('passkeys.deleted'))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('passkeys.delete'))
    } finally {
      setDeletingId(null)
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
            {!me.email ? <p className="profile-hint">{t('profile.email_recovery_hint')}</p> : null}
          </div>
          <div>
            <label className="label" htmlFor="profile-display-name">{t('auth.display_name')}</label>
            <input id="profile-display-name" className="input" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={savingProfile}>
            {savingProfile ? t('common.loading') : t('profile.save')}
          </button>
        </form>

        {/* Passkeys */}
        <section className="profile-section">
          <div className="page-eyebrow">{t('passkeys.security')}</div>
          <h2 className="font-display page-subtitle">{t('passkeys.title')}</h2>
          <p className="profile-section-desc">{t('passkeys.description')}</p>
          <p className="profile-section-desc">{t('passkeys.discoverable_hint')}</p>

          <div className="card passkey-card">
            {passkeys.length > 0 ? (
              <div className="passkey-list">
                {passkeys.map((passkey) => (
                  <div className="passkey-row" key={passkey.id}>
                    <div className="passkey-glyph" aria-hidden="true">⌁</div>
                    <div className="passkey-details">
                      <strong>{passkey.name}</strong>
                      <span>
                        {t('passkeys.created')} {new Date(passkey.created_at).toLocaleDateString()}
                        {passkey.last_used_at
                          ? ` · ${t('passkeys.last_used')} ${new Date(passkey.last_used_at).toLocaleDateString()}`
                          : ''}
                      </span>
                    </div>
                    <button
                      className="btn btn-danger-outline"
                      type="button"
                      disabled={deletingId === passkey.id}
                      onClick={() => deletePasskey(passkey.id)}
                    >
                      {t('passkeys.delete')}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="passkey-empty">
                <div className="passkey-glyph" aria-hidden="true">⌁</div>
                <div>
                  <strong>{t('passkeys.empty')}</strong>
                  <p>{t('passkeys.empty_hint')}</p>
                </div>
              </div>
            )}

            <form className="passkey-add" onSubmit={addPasskey}>
              <div className="flex-1">
                <label className="label" htmlFor="passkey-name">{t('passkeys.name')}</label>
                <input
                  id="passkey-name"
                  className="input"
                  value={name}
                  maxLength={64}
                  placeholder={t('passkeys.name_placeholder')}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={adding || !isPasskeySupported()}
              >
                {adding ? t('common.loading') : t('passkeys.add')}
              </button>
            </form>
            {!isPasskeySupported() ? (
              <p className="profile-hint">{t('auth.passkey_unsupported')}</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
