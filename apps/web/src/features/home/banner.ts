import type { Settings } from '@/features/shell/settings';
import type { Language } from '@/i18n/i18n';

const ARABIC = /\p{Script=Arabic}/u;

export interface BannerSubtitle {
  text: string;
  /** Language of the text itself: Latin text is shown letter-spaced in capitals, Arabic never. */
  lang: Language;
}

/**
 * The small line under the lab name: the lab's slogan when set, otherwise the lab name in the
 * other language (when both names exist, so the heading never repeats). Nothing is invented: no
 * slogan and one name → no line.
 */
export function bannerSubtitle(settings: Settings | undefined, lang: Language): BannerSubtitle | null {
  const p = settings?.labProfile;
  if (!p) return null;
  const slogan = p.slogan?.trim();
  if (slogan) return { text: slogan, lang: ARABIC.test(slogan) ? 'ar' : 'en' };
  const own = lang === 'ar' ? p.nameAr : p.nameEn;
  const other = lang === 'ar' ? p.nameEn : p.nameAr;
  if (!own?.trim() || !other?.trim()) return null;
  return { text: other.trim(), lang: lang === 'ar' ? 'en' : 'ar' };
}
