// Device or browser language list -> supported Locale. The first supported candidate wins,
// mirroring navigator.languages priority: any en-* maps to en-GB, any pt-* to pt-BR, any es-* to
// es; nothing supported falls back to en-GB.
import type { Locale } from './types';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './types';

const BY_PRIMARY_SUBTAG: Readonly<Record<string, Locale>> = {
  en: 'en-GB',
  es: 'es',
  pt: 'pt-BR',
};

// Exact, case-sensitive: validates persisted values, which are always written from SUPPORTED_LOCALES.
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function negotiateLocale(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const primary = candidate.trim().toLowerCase().replace(/_/g, '-').split('-')[0] ?? '';
    const locale = Object.prototype.hasOwnProperty.call(BY_PRIMARY_SUBTAG, primary)
      ? BY_PRIMARY_SUBTAG[primary]
      : undefined;
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
