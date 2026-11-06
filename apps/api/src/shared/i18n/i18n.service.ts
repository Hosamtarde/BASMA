import { Injectable } from '@nestjs/common';
import ar from './catalogs/ar.json';
import en from './catalogs/en.json';

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'ar';

export type Catalog = Record<string, string>;
export type TranslationParams = Record<string, string | number | boolean | null | undefined>;

const CATALOGS: Record<Language, Catalog> = { ar, en };

/**
 * Minimal in-house translator (ADR-0007): key lookup + `{param}` interpolation.
 * Unknown keys return the key itself so a missing entry is visible, never a crash.
 */
@Injectable()
export class I18nService {
  translate(key: string, params: TranslationParams = {}, language: Language = DEFAULT_LANGUAGE): string {
    const template = CATALOGS[language][key] ?? CATALOGS[DEFAULT_LANGUAGE][key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      return value === undefined || value === null ? match : String(value);
    });
  }

  /** Picks the first supported language from an Accept-Language header (by q-weight), default Arabic. */
  resolveLanguage(acceptLanguage: string | undefined): Language {
    if (!acceptLanguage) return DEFAULT_LANGUAGE;
    const ranked = acceptLanguage
      .split(',')
      .map((part, index) => {
        const [tag = '', ...rest] = part.trim().split(';');
        const qPart = rest.find((p) => p.trim().startsWith('q='));
        const q = qPart ? Number(qPart.trim().slice(2)) : 1;
        return { base: tag.toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0, index };
      })
      .filter((x) => x.q > 0)
      .sort((a, b) => b.q - a.q || a.index - b.index);
    const match = ranked.find((x) => (SUPPORTED_LANGUAGES as readonly string[]).includes(x.base));
    return (match?.base as Language | undefined) ?? DEFAULT_LANGUAGE;
  }
}
