import { useState } from 'react'
import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { availableLocales, changeLocale, type SupportedLocale } from '@/i18n'

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { me, tenants, loading, logout, refresh } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { showError, showSuccess, element } = useToast()
  const nav = useNavigate()
  const [tenantOpen, setTenantOpen] = useState(false)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)' }}>
          {t('common.loading')}
        </div>
      </div>
    )
  }
  if (!me) {
    return <Navigate to="/login" replace />
  }

  const currentTenant = tenants.find((tnt) => tnt.id === me.tenant_id)

  const handleLogout = async () => {
    await logout()
    nav('/login')
  }

  const switchTenant = async (id: number) => {
    try {
      await api.selectTenant(id)
      await refresh()
      setTenantOpen(false)
      showSuccess(t('workspace.switched'))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const navItem = (to: string, label: string) => (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        padding: 'var(--space-2xs) var(--space-xs)',
        borderRadius: 'var(--radius)',
        fontSize: 'var(--text-sm)',
        fontWeight: isActive ? 500 : 400,
        color: isActive ? 'var(--color-accent)' : 'var(--color-ink-2)',
        background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
        textDecoration: 'none',
        transition: 'background var(--dur-short) var(--ease-out), color var(--dur-short) var(--ease-out)',
      })}
      onMouseEnter={(e) => { if (!e.currentTarget.style.background.includes('accent-subtle')) e.currentTarget.style.color = 'var(--color-ink)' }}
      onMouseLeave={(e) => { if (!e.currentTarget.style.background.includes('accent-subtle')) e.currentTarget.style.color = 'var(--color-ink-2)' }}
    >
      {label}
    </NavLink>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '15rem',
          flexShrink: 0,
          borderRight: '1px solid var(--color-rule)',
          background: 'var(--color-paper-2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Brand + workspace selector */}
        <div style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-rule)' }}>
          <div
            className="font-display"
            style={{ fontWeight: 700, fontSize: 'var(--text-md)', letterSpacing: '-0.02em', color: 'var(--color-ink)' }}
          >
            {t('app.name')}
          </div>
          <div style={{ position: 'relative', marginTop: 'var(--space-sm)' }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%', justifyContent: 'space-between', fontWeight: 400 }}
              onClick={() => setTenantOpen(!tenantOpen)}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentTenant?.name || t('workspace.select')}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
                {tenantOpen ? '−' : '+'}
              </span>
            </button>
            {tenantOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: 'var(--space-2xs)',
                  padding: 'var(--space-2xs)',
                  background: 'var(--color-paper)',
                  border: '1px solid var(--color-rule)',
                  borderRadius: 'var(--radius)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 10,
                  maxHeight: '16rem',
                  overflow: 'auto',
                }}
                className="scrollbar-thin"
              >
                {tenants.map((tnt) => (
                  <div
                    key={tnt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--space-2xs) var(--space-xs)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      background: tnt.id === me.tenant_id ? 'var(--color-accent-subtle)' : 'transparent',
                      transition: 'background var(--dur-short) var(--ease-out)',
                    }}
                    onMouseEnter={(e) => { if (tnt.id !== me.tenant_id) e.currentTarget.style.background = 'var(--color-paper-3)' }}
                    onMouseLeave={(e) => { if (tnt.id !== me.tenant_id) e.currentTarget.style.background = 'transparent' }}
                    onClick={() => switchTenant(tnt.id)}
                  >
                    <span>{tnt.name}</span>
                    <span className="badge" style={{ marginLeft: 'var(--space-2xs)' }}>{tnt.role}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflow: 'auto', padding: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3xs)' }} className="scrollbar-thin">
          <div className="section-label" style={{ padding: '0 var(--space-2xs)', marginBottom: 'var(--space-3xs)' }}>
            {t('nav.bookmarks')}
          </div>
          {navItem('/bookmarks', t('nav.bookmarks'))}
          {navItem('/search', t('nav.search'))}
          {navItem('/trash', t('nav.trash'))}

          <div style={{ height: '1px', background: 'var(--color-rule)', margin: 'var(--space-xs) var(--space-2xs)' }} />

          <div className="section-label" style={{ padding: '0 var(--space-2xs)', marginBottom: 'var(--space-3xs)' }}>
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
              <div style={{ height: '1px', background: 'var(--color-rule)', margin: 'var(--space-xs) var(--space-2xs)' }} />
              <div className="section-label" style={{ padding: '0 var(--space-2xs)', marginBottom: 'var(--space-3xs)' }}>
                {t('nav.admin')}
              </div>
              {navItem('/admin', t('nav.admin'))}
            </>
          )}
        </nav>

        {/* Footer: locale + theme + user */}
        <div style={{ padding: 'var(--space-xs)', borderTop: '1px solid var(--color-rule)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2xs)', marginBottom: 'var(--space-2xs)' }}>
            <select
              className="input"
              style={{ flex: 1, padding: 'var(--space-3xs) var(--space-2xs)', fontSize: 'var(--text-xs)' }}
              value={i18n.language}
              onChange={(e) => changeLocale(e.target.value as SupportedLocale)}
              title={t('settings.language')}
            >
              {availableLocales.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <button
              className="btn btn-sm btn-icon"
              onClick={toggleTheme}
              title={t('settings.theme')}
              aria-label={t('settings.theme')}
            >
              {theme === 'dark' ? '☀' : theme === 'light' ? '☾' : '◐'}
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-2xs) var(--space-xs)',
              fontSize: 'var(--text-xs)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-2)' }}>{me.username}</span>
            <button
              className="btn btn-sm btn-ghost"
              style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-3xs) var(--space-2xs)' }}
              onClick={handleLogout}
            >
              {t('auth.logout')}
            </button>
          </div>
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
