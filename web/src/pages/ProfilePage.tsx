import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { createPasskey, isPasskeySupported } from '@/lib/webauthn'
import { useToast } from '@/components/Toast'

export function ProfilePage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { showError, showSuccess } = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const { data: passkeys = [] } = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api.listPasskeys(),
  })
  if (!me) return null

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
      if (err instanceof DOMException && err.name === 'NotAllowedError') return
      showError(err instanceof Error ? err.message : t('passkeys.add'))
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

  const rows = [
    { label: t('auth.username'), value: me.username },
    { label: t('profile.role'), value: me.tenant_role },
    { label: t('profile.system_admin'), value: me.is_system_admin ? t('common.yes') : t('common.no') },
  ]

  return (
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin">
      <div style={{ maxWidth: '36rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('settings.profile')}
        </div>
        <h1
          className="font-display"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-lg)' }}
        >
          {t('profile.title')}
        </h1>
        <div className="card" style={{ padding: 0 }}>
          {rows.map((row, i) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-sm) var(--space-md)',
                borderBottom: i < rows.length - 1 ? '1px solid var(--color-rule)' : 'none',
              }}
            >
              <span className="label" style={{ margin: 0 }}>{row.label}</span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink)', fontFamily: 'var(--font-mono)' }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <section style={{ marginTop: 'var(--space-xl)' }}>
          <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
            {t('passkeys.security')}
          </div>
          <div className="profile-section-heading">
            <div>
              <h2 className="font-display">{t('passkeys.title')}</h2>
              <p>{t('passkeys.description')}</p>
            </div>
          </div>

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
              <div style={{ flex: 1 }}>
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
              <p className="passkey-hint">{t('auth.passkey_unsupported')}</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
