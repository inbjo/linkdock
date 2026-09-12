import { useTranslation } from 'react-i18next'
import { useTheme } from '@/hooks/useTheme'
import { availableLocales, changeLocale, type SupportedLocale } from '@/i18n'

/** Compact language + theme switcher for auth pages (login/register). */
export function SettingsBar() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="auth-settings-bar" style={{ position: 'fixed', top: 'var(--space-md)', right: 'var(--space-md)', display: 'flex', gap: 'var(--space-2xs)', zIndex: 50 }}>
      <select
        className="auth-settings-select"
        value={i18n.language}
        onChange={(e) => changeLocale(e.target.value as SupportedLocale)}
        title={t('settings.language')}
        aria-label={t('settings.language')}
      >
        {availableLocales.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
      <button
        className="auth-theme-toggle"
        onClick={toggleTheme}
        title={t('settings.theme')}
        aria-label={t('settings.theme')}
      >
        {theme === 'dark' ? '☀' : theme === 'light' ? '☾' : '◐'}
      </button>
    </div>
  )
}
