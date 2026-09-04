import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { Navigate } from 'react-router-dom'

interface Stats {
  users: number
  tenants: number
  collections: number
  links: number
  tags: number
  tokens: number
  sessions: number
  audit_entries: number
}

interface AdminUser {
  id: number
  uuid: string
  username: string
  display_name: string
  is_system_admin: boolean
  disabled: boolean
  created_at: string
  tenant_count: number
}

interface AdminTenant {
  id: number
  uuid: string
  name: string
  slug: string
  created_by: number
  created_at: string
  member_count: number
  link_count: number
}

interface AuditEntry {
  id: number
  tenant_id: number | null
  user_id: number | null
  action: string
  resource_type: string | null
  resource_id: number | null
  detail: string | null
  ip_address: string | null
  created_at: string
}

export function AdminPage() {
  const { t } = useTranslation()
  const { me } = useAuth()

  if (!me) return null
  if (!me.is_system_admin) return <Navigate to="/bookmarks" replace />

  return (
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin">
      <div style={{ maxWidth: '56rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('nav.admin')}
        </div>
        <h1
          className="font-display"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-lg)' }}
        >
          {t('admin.title')}
        </h1>
        <StatsSection />
        <UsersSection />
        <TenantsSection />
        <AuditSection />
      </div>
    </div>
  )
}

function StatsSection() {
  const { t } = useTranslation()
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/stats', { credentials: 'same-origin' })
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  if (isLoading) return <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-lg)' }}>{t('common.loading')}</div>
  if (!stats) return null

  const items = [
    { label: t('admin.users'), value: stats.users },
    { label: t('admin.tenants'), value: stats.tenants },
    { label: t('admin.collections'), value: stats.collections },
    { label: t('admin.links'), value: stats.links },
    { label: t('admin.tags'), value: stats.tags },
    { label: t('admin.active_tokens'), value: stats.tokens },
    { label: t('admin.active_sessions'), value: stats.sessions },
    { label: t('admin.audit_entries'), value: stats.audit_entries },
  ]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))',
        gap: 'var(--space-2xs)',
        marginBottom: 'var(--space-xl)',
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            padding: 'var(--space-sm)',
            border: '1px solid var(--color-rule)',
            borderRadius: 'var(--radius)',
            background: 'var(--color-paper)',
          }}
        >
          <div
            className="font-display"
            style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.02em' }}
          >
            {item.value.toLocaleString()}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginTop: 'var(--space-3xs)',
            }}
          >
            {item.label}
          </div>
        </div>
      ))}
    </div>
  )
}

function UsersSection() {
  const { t } = useTranslation()
  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/users', { credentials: 'same-origin' })
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>{t('admin.users')}</div>
      {isLoading ? (
        <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{t('common.loading')}</div>
      ) : (
        <div style={{ border: '1px solid var(--color-rule)', borderRadius: 'var(--radius)', overflow: 'auto' }} className="scrollbar-thin">
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.id')}</th>
                <th>{t('admin.username')}</th>
                <th>{t('admin.display_name')}</th>
                <th>{t('admin.admin_flag')}</th>
                <th>{t('admin.disabled')}</th>
                <th>{t('admin.tenants')}</th>
                <th>{t('admin.created')}</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map((u) => (
                <tr key={u.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{u.id}</td>
                  <td className="font-display" style={{ fontWeight: 500 }}>{u.username}</td>
                  <td style={{ color: 'var(--color-ink-2)' }}>{u.display_name}</td>
                  <td>{u.is_system_admin ? <span className="badge badge-accent">✓</span> : <span style={{ color: 'var(--color-ink-3)' }}>—</span>}</td>
                  <td>{u.disabled ? <span className="badge badge-danger">✓</span> : <span style={{ color: 'var(--color-ink-3)' }}>—</span>}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{u.tenant_count}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TenantsSection() {
  const { t } = useTranslation()
  const { data: tenants, isLoading } = useQuery<AdminTenant[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/tenants', { credentials: 'same-origin' })
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>{t('admin.tenants')}</div>
      {isLoading ? (
        <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{t('common.loading')}</div>
      ) : (
        <div style={{ border: '1px solid var(--color-rule)', borderRadius: 'var(--radius)', overflow: 'auto' }} className="scrollbar-thin">
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.id')}</th>
                <th>{t('admin.name')}</th>
                <th>{t('admin.slug')}</th>
                <th>{t('admin.members')}</th>
                <th>{t('admin.links')}</th>
                <th>{t('admin.created')}</th>
              </tr>
            </thead>
            <tbody>
              {(tenants || []).map((tnt) => (
                <tr key={tnt.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{tnt.id}</td>
                  <td className="font-display" style={{ fontWeight: 500 }}>{tnt.name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-2)' }}>{tnt.slug}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{tnt.member_count}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{tnt.link_count}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{new Date(tnt.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AuditSection() {
  const { t } = useTranslation()
  const { data: entries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['admin', 'audit'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/audit?limit=50', { credentials: 'same-origin' })
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div>
      <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>
        {t('admin.audit_log')} · {t('admin.last_50')}
      </div>
      {isLoading ? (
        <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{t('common.loading')}</div>
      ) : (
        <div
          style={{ border: '1px solid var(--color-rule)', borderRadius: 'var(--radius)', overflow: 'auto', maxHeight: '24rem' }}
          className="scrollbar-thin"
        >
          <table className="table" style={{ fontSize: 'var(--text-xs)' }}>
            <thead>
              <tr>
                <th>{t('admin.id')}</th>
                <th>{t('admin.time')}</th>
                <th>{t('admin.action')}</th>
                <th>{t('admin.resource')}</th>
                <th>{t('admin.user')}</th>
                <th>{t('admin.tenant')}</th>
                <th>{t('admin.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {(entries || []).map((e) => (
                <tr key={e.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{e.id}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{new Date(e.created_at).toLocaleString()}</td>
                  <td className="font-display" style={{ fontWeight: 500 }}>{e.action}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{e.resource_type}{e.resource_id ? `:${e.resource_id}` : ''}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{e.user_id ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{e.tenant_id ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{e.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
