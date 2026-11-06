import { I18nService } from './i18n.service';

describe('I18nService', () => {
  const i18n = new I18nService();

  it('translates in Arabic by default and in English on request', () => {
    expect(i18n.translate('error.auth.forbidden')).toBe('ليس لديك صلاحية لهذه العملية.');
    expect(i18n.translate('error.auth.forbidden', {}, 'en')).toBe(
      'You do not have permission for this action.',
    );
  });

  it('interpolates params and leaves unknown placeholders visible', () => {
    expect(i18n.translate('audit.auth.account_locked', { attempts: 5 }, 'en')).toContain('after 5 failed');
    expect(i18n.translate('audit.auth.account_locked', {}, 'en')).toContain('{attempts}');
  });

  it('returns the key itself for an unknown key', () => {
    expect(i18n.translate('error.does_not_exist')).toBe('error.does_not_exist');
  });

  it.each([
    [undefined, 'ar'],
    ['', 'ar'],
    ['en', 'en'],
    ['en-US,en;q=0.9', 'en'],
    ['fr-FR, en;q=0.5', 'en'],
    ['ar-PS', 'ar'],
    ['ar;q=0.3, en;q=0.8', 'en'],
    ['de, fr', 'ar'],
    ['en;q=0', 'ar'],
  ])('resolveLanguage(%p) → %s', (header, expected) => {
    expect(i18n.resolveLanguage(header)).toBe(expected);
  });
});
