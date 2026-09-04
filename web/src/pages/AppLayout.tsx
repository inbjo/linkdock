import { useState } from 'react'
import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'

export function AppLayout() {
  const { t } = useTranslation()
  const { me, tenants, loading, logout, refresh } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const nav = useNavigate()
  const [tenantOpen, setTenantOpen] = useState(false)

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>{t('common.loading')}</div>
  }
  if (!me) {
    return <Navigate to="/login" replace />
  }

  const currentTenant = tenants.find((t) => t.id === me.tenant_id)

  const handleLogout = async () => {
    await logout()
    nav('/login')
  }

  const switchTenant = async (id: number) => {
    try {
      await api.selectTenant(id)
      await refresh()
      setTenantOpen(false)
      showSuccess('Workspace switched')
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to switch')
    }
  }

  const navItem = (to: string, label: string) => (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'block',
        padding: '0.5rem 0.75rem',
        borderRadius: '0.25rem',
        fontSize: '0.875rem',
        fontWeight: 500,
        color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
        background: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
        textDecoration: 'none',
      })}
    >
      {label}
    </NavLink>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '16rem',
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{t('app.name')}</div>
          <div style={{ position: 'relative', marginTop: '0.5rem' }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%', justifyContent: 'space-between' }}
              onClick={() => setTenantOpen(!tenantOpen)}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentTenant?.name || 'Select workspace'}
              </span>
              <span>{tenantOpen ? '▴' : '▾'}</span>
            </button>
            {tenantOpen && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '0.25rem',
                  padding: '0.25rem',
                  zIndex: 10,
                  maxHeight: '16rem',
                  overflow: 'auto',
                }}
              >
                {tenants.map((tnt) => (
                  <div
                    key={tnt.id}
                    style={{
                      padding: '0.375rem 0.5rem',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                      background: tnt.id === me.tenant_id ? 'var(--color-bg-tertiary)' : 'transparent',
                    }}
                    onClick={() => switchTenant(tnt.id)}
                  >
                    {tnt.name} <span className="badge" style={{ marginLeft: '0.25rem' }}>{tnt.role}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <nav style={{ flex: 1, overflow: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.125rem' }} className="scrollbar-thin">
          {navItem('/bookmarks', t('nav.bookmarks'))}
          {navItem('/search', t('nav.search'))}
          {navItem('/trash', t('nav.trash'))}
          <div style={{ height: '1px', background: 'var(--color-border)', margin: '0.5rem 0' }} />
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', padding: '0 0.75rem', marginBottom: '0.25rem' }}>
            {t('nav.settings')}
          </div>
          {navItem('/settings/profile', t('settings.profile'))}
          {navItem('/settings/workspace', t('settings.workspace'))}
          {navItem('/settings/members', t('settings.members'))}
          {navItem('/settings/tokens', t('settings.tokens'))}
          {navItem('/settings/sync', t('settings.sync'))}
          {navItem('/settings/import-export', t('settings.import_export'))}
          {me.is_system_admin && (
            <>
              <div style={{ height: '1px', background: 'var(--color-border)', margin: '0.5rem 0' }} />
              {navItem('/admin', t('nav.admin'))}
            </>
          )}
        </nav>

        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--color-border)', fontSize: '0.75rem' }}>
          <div style={{ color: 'var(--color-text-secondary)' }}>{me.username}</div>
          <button className="btn btn-sm" style={{ marginTop: '0.5rem', width: '100%' }} onClick={handleLogout}>
            {t('auth.logout')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto' }} className="scrollbar-thin">
        <Outlet />
      </main>
      {element}
    </div>
  )
}
