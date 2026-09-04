import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'

export function ProfilePage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  if (!me) return null
  return (
    <div style={{ padding: '1rem', maxWidth: '32rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('settings.profile')}</h1>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div><label className="label">{t('auth.username')}</label><div>{me.username}</div></div>
        <div><label className="label">Role</label><div>{me.tenant_role}</div></div>
        <div><label className="label">System Admin</label><div>{me.is_system_admin ? 'Yes' : 'No'}</div></div>
      </div>
    </div>
  )
}
