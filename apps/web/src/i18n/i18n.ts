import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import en from './en.json';

/** Arabic is the default; English is switchable (SPEC §6.1). Adding a language = one catalog. */
export const LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'ar';

/** Only the language choice of the login page is kept in the browser (no data, no tokens). */
const STORAGE_KEY = 'dentallab.language';

export const isLanguage = (value: unknown): value is Language => value === 'ar' || value === 'en';
export const directionOf = (lang: Language): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');
export const otherLanguage = (lang: Language): Language => (lang === 'ar' ? 'en' : 'ar');

export function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function rememberLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
}

function applyToDocument(lang: Language): void {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = directionOf(lang);
}

export function currentLanguage(): Language {
  const lang = i18next.resolvedLanguage ?? i18next.language;
  return isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
}

/** Changes the UI language in place: catalogs, `<html lang dir>`, and every formatter. */
export async function changeLanguage(lang: Language): Promise<void> {
  if (currentLanguage() !== lang || document.documentElement.lang !== lang) {
    await i18next.changeLanguage(lang);
  }
  applyToDocument(lang);
}

export async function initI18n(lang: Language = storedLanguage()): Promise<typeof i18next> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources: { ar: { translation: ar }, en: { translation: en } },
      lng: lang,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: LANGUAGES,
      // React escapes text already; catalogs never contain HTML.
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else {
    await i18next.changeLanguage(lang);
  }
  applyToDocument(lang);
  return i18next;
}

export { i18next };
