import { useTranslation } from 'react-i18next'
import { useTheme } from '@/hooks/useTheme'
import { availableLocales, changeLocale, type SupportedLocale } from '@/i18n'

/** Compact language + theme switcher for auth pages (login/register). */
export function SettingsBar() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ position: 'fixed', top: '1rem', right: '1rem', display: 'flex', gap: '0.375rem', zIndex: 50 }}>
      <select
        className="input"
        style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
        value={i18n.language}
        onChange={(e) => changeLocale(e.target.value as SupportedLocale)}
        title={t('settings.language')}
      >
        {availableLocales.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
      <button
        className="btn btn-sm"
        style={{ padding: '0.25rem 0.5rem' }}
        onClick={toggleTheme}
        title={t('settings.theme')}
      >
        {theme === 'dark' ? '☀' : theme === 'light' ? '☾' : '◐'}
      </button>
    </div>
  )
}
