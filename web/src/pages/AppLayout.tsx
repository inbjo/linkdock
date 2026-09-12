import { useEffect, useRef, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useToast } from '@/components/Toast'
import { availableLocales, changeLocale, type SupportedLocale } from '@/i18n'

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { me, loading, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { element } = useToast()
  const nav = useNavigate()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
    setMobileNavOpen(false)
  }, [location.pathname])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--color-ink-3)] font-mono text-sm">
        {t('common.loading')}
      </div>
    )
  }
  if (!me) {
    return <Navigate to="/login" replace />
  }

  const handleLogout = async () => {
    await logout()
    nav('/login')
  }

  const navItem = (to: string, label: string) => (
    <NavLink
      to={to}
      className="app-nav-link"
      onClick={() => setMobileNavOpen(false)}
    >
      {label}
    </NavLink>
  )

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={`app-sidebar${mobileNavOpen ? ' is-mobile-open' : ''}`}>
        {/* Brand */}
        <div className="app-brand-block">
          <div className="app-brand-header">
            <div className="font-display app-brand-name">{t('app.name')}</div>
            <button
              className="app-mobile-toggle"
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
        </div>

        {/* Nav */}
        <nav id="app-navigation" className="app-nav scrollbar-thin">
          <div className="app-nav-section">{t('nav.bookmarks')}</div>
          {navItem('/bookmarks', t('nav.bookmarks'))}

          <div className="app-nav-divider" />

          <div className="app-nav-section">{t('nav.settings')}</div>
          {navItem('/settings/profile', t('settings.profile'))}
          {navItem('/settings/tokens', t('settings.tokens'))}
          {navItem('/settings/sync', t('settings.sync'))}

          {me.is_system_admin && (
            <>
              <div className="app-nav-divider" />
              <div className="app-nav-section">{t('nav.admin')}</div>
              {navItem('/admin', t('nav.admin'))}
            </>
          )}
        </nav>

        {/* Footer: locale + theme + user */}
        <div className="app-sidebar-footer">
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
              className="app-sidebar-tool"
              onClick={toggleTheme}
              title={t('settings.theme')}
              aria-label={t('settings.theme')}
            >
              {theme === 'dark' ? '☀' : theme === 'light' ? '☾' : '◐'}
            </button>
            <a
              className="app-sidebar-tool"
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
          <div className="app-user-row">
            <span className="app-user-name">{me.username}</span>
            <button className="app-logout-btn" onClick={handleLogout}>
              {t('auth.logout')}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main ref={mainRef} className="app-main scrollbar-thin min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      {element}
    </div>
  )
}
