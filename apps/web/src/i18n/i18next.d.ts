import 'i18next';
import type ar from './ar.json';

/** Typed keys: t('missing.key') is a compile error. Arabic is the reference catalog. */
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof ar };
    returnNull: false;
  }
}
