import { useEffect, useRef, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom'
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
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [tenantOpen, setTenantOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
    setMobileNavOpen(false)
    setTenantOpen(false)
  }, [location.pathname])

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
      className="app-nav-link"
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
      onClick={() => setMobileNavOpen(false)}
    >
      {label}
    </NavLink>
  )

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside
        className={`app-sidebar${mobileNavOpen ? ' is-mobile-open' : ''}`}
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
        <div className="app-brand-block" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-rule)' }}>
          <div className="app-brand-header">
            <div
              className="font-display"
              style={{ fontWeight: 700, fontSize: 'var(--text-md)', letterSpacing: '-0.02em', color: 'var(--color-ink)' }}
            >
              {t('app.name')}
            </div>
            <button
              className="btn btn-icon app-mobile-toggle"
              type="button"
              aria-label={mobileNavOpen ? t('common.close') : t('common.menu')}
              aria-expanded={mobileNavOpen}
              aria-controls="app-navigation"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>
          <div className="app-workspace-switcher" style={{ position: 'relative', marginTop: 'var(--space-sm)' }}>
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
        <nav id="app-navigation" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3xs)' }} className="scrollbar-thin app-nav">
          <div className="section-label" style={{ padding: '0 var(--space-2xs)', marginBottom: 'var(--space-3xs)' }}>
            {t('nav.bookmarks')}
          </div>
          {navItem('/bookmarks', t('nav.bookmarks'))}
          {navItem('/search', t('nav.search'))}
          {navItem('/trash', t('nav.trash'))}

          <div className="divider" style={{ height: '1px', background: 'var(--color-rule)', margin: 'var(--space-xs) var(--space-2xs)' }} />

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
              <div className="divider" style={{ height: '1px', background: 'var(--color-rule)', margin: 'var(--space-xs) var(--space-2xs)' }} />
              <div className="section-label" style={{ padding: '0 var(--space-2xs)', marginBottom: 'var(--space-3xs)' }}>
                {t('nav.admin')}
              </div>
              {navItem('/admin', t('nav.admin'))}
            </>
          )}
        </nav>

        {/* Footer: locale + theme + user */}
        <div className="app-sidebar-footer" style={{ padding: 'var(--space-xs)', borderTop: '1px solid var(--color-rule)' }}>
          <div className="app-sidebar-tools">
            <label className="app-locale-control" title={t('settings.language')}>
              <span className="sr-only">{t('settings.language')}</span>
              <select
                className="app-locale-select"
                value={i18n.language}
                onChange={(e) => changeLocale(e.target.value as SupportedLocale)}
                aria-label={t('settings.language')}
              >
                {availableLocales.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <svg className="app-locale-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>
            <button
              className="btn btn-icon app-sidebar-tool"
              onClick={toggleTheme}
              title={t('settings.theme')}
              aria-label={t('settings.theme')}
            >
              {theme === 'dark' ? '☀' : theme === 'light' ? '☾' : '◐'}
            </button>
            <a
              className="btn btn-icon app-sidebar-tool"
              href="https://github.com/inbjo/linkdock"
              target="_blank"
              rel="noreferrer"
              title="GitHub"
              aria-label="GitHub"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A10.9 10.9 0 0 1 12 6.11c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
              </svg>
            </a>
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
      <main ref={mainRef} style={{ flex: 1, overflow: 'auto' }} className="scrollbar-thin app-main min-w-0">
        <Outlet />
      </main>
      {element}
    </div>
  )
}
