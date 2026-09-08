import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './locales/en'
import { zh } from './locales/zh'

export type SupportedLocale = 'en' | 'zh'

export const availableLocales: { code: SupportedLocale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
]

const STORAGE_KEY = 'linkdock.locale'

function detectInitialLocale(): SupportedLocale {
  // 1. Explicit user choice in localStorage
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'zh') return stored

  // 2. Browser language
  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
  if (browserLanguages.some((language) => language.toLowerCase().startsWith('zh'))) return 'zh'

  // 3. Default
  return 'en'
}

const initialLocale = detectInitialLocale()

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

// Persist locale changes
i18n.on('languageChanged', (lng: string) => {
  localStorage.setItem(STORAGE_KEY, lng)
  document.documentElement.lang = lng
})

// Set initial lang attribute
document.documentElement.lang = initialLocale

export function changeLocale(locale: SupportedLocale) {
  i18n.changeLanguage(locale)
}

export default i18n
