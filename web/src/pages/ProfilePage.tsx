import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'

export function ProfilePage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  if (!me) return null

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
      </div>
    </div>
  )
}
