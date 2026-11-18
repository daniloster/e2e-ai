// Language resolution and switching for the static pages privacy.html, terms.html and 404.html,
// including the shared header/footer chrome labels (data-i18n-*, data-href-*, data-label-*).
// Copied verbatim to dist/ (never bundled), so it has no imports; it mirrors @pn/i18n
// negotiateLocale, kept in lockstep by scripts/legal-lang.test.mjs. No storage, no network.

export const LEGAL_LOCALES = Object.freeze(['en-GB', 'es', 'pt-BR']);

const BY_PRIMARY_SUBTAG = Object.freeze({ en: 'en-GB', es: 'es', pt: 'pt-BR' });

/** 'en-GB' | 'es' | 'pt-BR' for a supported tag, else null. */
export function localeFromTag(tag) {
  if (typeof tag !== 'string') return null;
  const primary = tag.trim().toLowerCase().replace(/_/g, '-').split('-')[0] ?? '';
  return Object.prototype.hasOwnProperty.call(BY_PRIMARY_SUBTAG, primary)
    ? BY_PRIMARY_SUBTAG[primary]
    : null;
}

/** ?lang= first when it maps, else the first mapping browser language, else 'en-GB'. Never throws. */
export function resolveLegalLocale(langParam, languages) {
  const fromParam = localeFromTag(langParam);
  if (fromParam) return fromParam;
  if (Array.isArray(languages)) {
    for (const tag of languages) {
      const locale = localeFromTag(tag);
      if (locale) return locale;
    }
  }
  return 'en-GB';
}

// Text, href and aria-label of the shared chrome for one locale; suffix = locale.toLowerCase().
// An element without the locale's variant keeps its current value. Text is set with textContent only.
export function applySiteChrome(doc, locale) {
  const suffix = String(locale).toLowerCase();
  for (const el of doc.querySelectorAll('[data-i18n-en-gb]')) {
    const text = el.getAttribute(`data-i18n-${suffix}`);
    if (text !== null) el.textContent = text;
  }
  for (const el of doc.querySelectorAll('[data-href-en-gb]')) {
    const href = el.getAttribute(`data-href-${suffix}`);
    if (href !== null) el.setAttribute('href', href);
  }
  for (const el of doc.querySelectorAll('[data-label-en-gb]')) {
    const label = el.getAttribute(`data-label-${suffix}`);
    if (label !== null) el.setAttribute('aria-label', label);
  }
}

export function applyLegalLocale(doc, locale) {
  let active = null;
  for (const article of doc.querySelectorAll('article[data-locale]')) {
    const match = article.getAttribute('data-locale') === locale;
    article.hidden = !match;
    if (match) active = article;
  }
  doc.documentElement.lang = locale;
  const title = active?.getAttribute('data-title');
  if (title) doc.title = title;
  for (const link of doc.querySelectorAll('nav[data-legal-langs] a[hreflang]')) {
    if (link.getAttribute('hreflang') === locale) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  applySiteChrome(doc, locale);
}

export function initLegalPage(win) {
  if (!win.document.querySelector('[data-legal-page]')) return;
  const lang = new URLSearchParams(win.location.search).get('lang');
  applyLegalLocale(win.document, resolveLegalLocale(lang, win.navigator.languages));
}

if (typeof window !== 'undefined') initLegalPage(window);
