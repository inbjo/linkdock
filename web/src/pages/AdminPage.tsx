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
    <div style={{ padding: '1rem', maxWidth: '60rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('admin.title')}</h1>
      <StatsSection />
      <UsersSection />
      <TenantsSection />
      <AuditSection />
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

  if (isLoading) return <div>{t('common.loading')}</div>
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
      {items.map((item) => (
        <div key={item.label} className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{item.value.toLocaleString()}</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>{item.label}</div>
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
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('admin.users')}</h2>
      {isLoading ? <div>{t('common.loading')}</div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.id')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.username')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.display_name')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.admin_flag')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.disabled')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.tenants')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.created')}</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{u.id}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{u.username}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{u.display_name}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{u.is_system_admin ? '✓' : ''}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{u.disabled ? '✓' : ''}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{u.tenant_count}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
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
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('admin.tenants')}</h2>
      {isLoading ? <div>{t('common.loading')}</div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.id')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.name')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.slug')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.members')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.links')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('admin.created')}</th>
              </tr>
            </thead>
            <tbody>
              {(tenants || []).map((tnt) => (
                <tr key={tnt.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{tnt.id}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{tnt.name}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{tnt.slug}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{tnt.member_count}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{tnt.link_count}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)' }}>{new Date(tnt.created_at).toLocaleDateString()}</td>
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
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('admin.audit_log')} ({t('admin.last_50')})</h2>
      {isLoading ? <div>{t('common.loading')}</div> : (
        <div className="card scrollbar-thin" style={{ padding: 0, overflow: 'auto', maxHeight: '24rem' }}>
          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.375rem 0.5rem' }}>{t('admin.id')}</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>{t('admin.time')}</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>{t('admin.action')}</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>{t('admin.resource')}</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>{t('admin.user')}</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>{t('admin.tenant')}</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>{t('admin.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {(entries || []).map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.375rem 0.5rem' }}>{e.id}</td>
                  <td style={{ padding: '0.375rem 0.5rem', color: 'var(--color-text-secondary)' }}>{new Date(e.created_at).toLocaleString()}</td>
                  <td style={{ padding: '0.375rem 0.5rem', fontWeight: 600 }}>{e.action}</td>
                  <td style={{ padding: '0.375rem 0.5rem' }}>{e.resource_type}{e.resource_id ? `:${e.resource_id}` : ''}</td>
                  <td style={{ padding: '0.375rem 0.5rem' }}>{e.user_id ?? '-'}</td>
                  <td style={{ padding: '0.375rem 0.5rem' }}>{e.tenant_id ?? '-'}</td>
                  <td style={{ padding: '0.375rem 0.5rem', color: 'var(--color-text-secondary)' }}>{e.ip_address ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
