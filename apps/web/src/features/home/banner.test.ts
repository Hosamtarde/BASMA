import { describe, expect, it } from 'vitest';
import { settingsFixture } from '@/test/fixtures';
import { bannerSubtitle } from './banner';

const withProfile = (p: Partial<NonNullable<ReturnType<typeof settingsFixture>['labProfile']>>) => {
  const s = settingsFixture();
  return { ...s, labProfile: { ...s.labProfile!, ...p } };
};

describe('bannerSubtitle', () => {
  it('prefers the slogan and tells its language by its script', () => {
    expect(bannerSubtitle(withProfile({ slogan: 'Precision in every tooth' }), 'ar')).toEqual({
      text: 'Precision in every tooth',
      lang: 'en',
    });
    expect(bannerSubtitle(withProfile({ slogan: ' الدقة في كل سن ' }), 'en')).toEqual({
      text: 'الدقة في كل سن',
      lang: 'ar',
    });
  });

  it('without a slogan shows the name in the other language', () => {
    expect(bannerSubtitle(withProfile({ slogan: null }), 'ar')).toEqual({ text: 'Test Lab', lang: 'en' });
    expect(bannerSubtitle(withProfile({ slogan: '  ' }), 'en')).toEqual({
      text: 'مختبر الاختبار',
      lang: 'ar',
    });
  });

  it('shows nothing when the heading already uses the only name', () => {
    expect(bannerSubtitle(withProfile({ nameEn: null }), 'ar')).toBeNull();
    expect(bannerSubtitle(withProfile({ nameEn: null }), 'en')).toBeNull();
    expect(bannerSubtitle(withProfile({ nameAr: null }), 'ar')).toBeNull();
    expect(bannerSubtitle({ ...settingsFixture(), labProfile: null }, 'ar')).toBeNull();
  });
});
