// The language suggestion and its pn.siteLocale dismissals. Storage is passed in. Never throws.
import type { Locale } from '@pn/i18n';

import { SITE_LOCALES } from '../config';

export interface SiteLocalePrefs {
  dismissed: Locale[];
}

export const SITE_LOCALE_KEY = 'pn.siteLocale';

const PRIMARY_SUBTAGS: Readonly<Record<string, Locale>> = Object.freeze({
  en: 'en-GB',
  es: 'es',
  // pt-BR is the only Portuguese locale, so pt-PT reads it too.
  pt: 'pt-BR',
});

const NO_PREFS: SiteLocalePrefs = Object.freeze<SiteLocalePrefs>({
  dismissed: Object.freeze<Locale[]>([]) as Locale[],
});

/** By primary subtag, case-insensitive: en* -> en-GB, es* -> es, pt* -> pt-BR, else null. */
export function localeOfLanguageTag(tag: string): Locale | null {
  const primary = (tag.split('-')[0] ?? '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PRIMARY_SUBTAGS, primary)
    ? (PRIMARY_SUBTAGS[primary] ?? null)
    : null;
}

/** Only the first supported language counts: null when it is the page's own or was dismissed. */
export function suggestedLocale(
  pageLocale: Locale,
  languages: readonly string[],
  prefs: SiteLocalePrefs,
): Locale | null {
  for (const tag of languages) {
    const locale = typeof tag === 'string' ? localeOfLanguageTag(tag) : null;
    if (locale === null) continue;
    return locale === pageLocale || prefs.dismissed.includes(locale) ? null : locale;
  }
  return null;
}

function parsePrefs(value: unknown): SiteLocalePrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NO_PREFS;
  const { dismissed } = value as Record<string, unknown>;
  if (!Array.isArray(dismissed)) return NO_PREFS;
  const kept = SITE_LOCALES.filter((locale) => dismissed.includes(locale));
  return Object.freeze<SiteLocalePrefs>({ dismissed: Object.freeze(kept) as Locale[] });
}

/** { dismissed: [] } when storage is null, unreadable, unset, corrupt or the wrong shape. Frozen. */
export function readLocalePrefs(storage: Pick<Storage, 'getItem'> | null): SiteLocalePrefs {
  if (storage === null) return NO_PREFS;
  let text: string | null;
  try {
    text = storage.getItem(SITE_LOCALE_KEY);
  } catch {
    return NO_PREFS;
  }
  if (text === null) return NO_PREFS;
  try {
    return parsePrefs(JSON.parse(text));
  } catch {
    return NO_PREFS;
  }
}

/** Stores { dismissed } as JSON; a null, blocked or full storage is ignored. */
export function writeLocalePrefs(
  storage: Pick<Storage, 'setItem'> | null,
  prefs: SiteLocalePrefs,
): void {
  if (storage === null) return;
  try {
    storage.setItem(SITE_LOCALE_KEY, JSON.stringify({ dismissed: prefs.dismissed }));
  } catch {
    // The dismissal still applies for this page view.
  }
}

/** Reveal the suggested variant without moving focus; dismiss -> hide, store, focus #main if focus was inside. */
export function mountLocaleSuggestion(
  doc: Document,
  deps: {
    pageLocale: Locale;
    languages: readonly string[];
    storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  },
): void {
  try {
    const prefs = readLocalePrefs(deps.storage);
    const suggested = suggestedLocale(deps.pageLocale, deps.languages, prefs);
    if (suggested === null) return;
    const bar = doc.querySelector<HTMLElement>(`[data-locale-suggestion="${suggested}"]`);
    if (!bar) return;
    bar.querySelector('[data-locale-dismiss]')?.addEventListener('click', () => {
      const hadFocus = bar.contains(doc.activeElement);
      bar.hidden = true;
      const dismissed = prefs.dismissed.includes(suggested)
        ? prefs.dismissed
        : [...prefs.dismissed, suggested];
      writeLocalePrefs(deps.storage, { dismissed });
      if (hadFocus) doc.getElementById('main')?.focus();
    });
    bar.hidden = false;
  } catch {
    // The suggestion is a convenience; the page works without it.
  }
}
