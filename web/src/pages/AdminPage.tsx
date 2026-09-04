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
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('nav.admin')}</h1>
      <StatsSection />
      <UsersSection />
      <TenantsSection />
      <AuditSection />
    </div>
  )
}

function StatsSection() {
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/stats')
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  if (isLoading) return <div>Loading...</div>
  if (!stats) return null

  const items = [
    { label: 'Users', value: stats.users },
    { label: 'Tenants', value: stats.tenants },
    { label: 'Collections', value: stats.collections },
    { label: 'Links', value: stats.links },
    { label: 'Tags', value: stats.tags },
    { label: 'Active Tokens', value: stats.tokens },
    { label: 'Active Sessions', value: stats.sessions },
    { label: 'Audit Entries', value: stats.audit_entries },
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
  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/users')
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Users</h2>
      {isLoading ? <div>Loading...</div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>ID</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Username</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Display Name</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Admin</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Disabled</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Tenants</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Created</th>
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
  const { data: tenants, isLoading } = useQuery<AdminTenant[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/tenants')
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Tenants</h2>
      {isLoading ? <div>Loading...</div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>ID</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Name</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Slug</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Members</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Links</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {(tenants || []).map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{t.id}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{t.name}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{t.slug}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{t.member_count}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{t.link_count}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-secondary)' }}>{new Date(t.created_at).toLocaleDateString()}</td>
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
  const { data: entries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['admin', 'audit'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/audit?limit=50')
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Audit Log (last 50)</h2>
      {isLoading ? <div>Loading...</div> : (
        <div className="card scrollbar-thin" style={{ padding: 0, overflow: 'auto', maxHeight: '24rem' }}>
          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.375rem 0.5rem' }}>ID</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>Time</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>Action</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>Resource</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>User</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>Tenant</th>
                <th style={{ padding: '0.375rem 0.5rem' }}>IP</th>
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
