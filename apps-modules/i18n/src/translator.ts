// Dependency-free translator: catalog lookup, {name} interpolation, Intl.PluralRules plurals and
// an en-GB fallback that warns once per key in development builds.
import type { Catalog, Locale, MessageKey, Params, Translator } from './types';
import { enGB } from './locales/en-GB';
import { es } from './locales/es';
import { ptBR } from './locales/pt-BR';

// Module-scoped so it never conflicts with @types/node in a consumer program. Vite and Metro
// replace the literal `process.env.NODE_ENV` text at build time.
declare const process: { env: { NODE_ENV?: string } };

type Category = 'one' | 'other';

export const CATALOGS: Readonly<Record<Locale, Catalog>> = { 'en-GB': enGB, es, 'pt-BR': ptBR };

export function isProductionBuild(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

export function defaultWarn(message: string): void {
  if (isProductionBuild()) return;
  (globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(message);
}

function createPluralRules(locale: Locale): Intl.PluralRules | null {
  return typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function'
    ? new Intl.PluralRules(locale)
    : null;
}

// Every non-'one' CLDR category (two, few, many, other) uses the _other form.
function pluralCategory(rules: Intl.PluralRules | null, count: number): Category {
  const category = rules ? rules.select(count) : count === 1 ? 'one' : 'other';
  return category === 'one' ? 'one' : 'other';
}

// 0 prefers _zero, then _other (CLDR says 'one' for 0 in Portuguese, which reads wrongly).
function pluralCandidates(key: string, count: number, category: Category): string[] {
  if (count === 0) return [`${key}_zero`, `${key}_other`];
  return category === 'one' ? [`${key}_one`, `${key}_other`] : [`${key}_other`];
}

// Single pass: a substituted value is never scanned again.
function interpolate(
  template: string,
  params: Params | undefined,
  onMissing: (name: string) => void,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (params && Object.prototype.hasOwnProperty.call(params, name)) return String(params[name]);
    onMissing(name);
    return match;
  });
}

export function createTranslatorWith(
  locale: Locale,
  catalogs: Readonly<Record<Locale, Catalog>>,
  warn: (message: string) => void,
): Translator {
  const rules = createPluralRules(locale);
  const warned = new Set<string>();
  const warnOnce = (id: string, message: string) => {
    if (warned.has(id)) return;
    warned.add(id);
    warn(message);
  };

  const lookup = (catalog: Catalog, key: string, count: number | null): string | undefined => {
    if (count !== null) {
      for (const candidate of pluralCandidates(key, count, pluralCategory(rules, count))) {
        const found = catalog[candidate];
        if (found !== undefined) return found;
      }
    }
    return catalog[key] ?? (count === null ? catalog[`${key}_other`] : undefined);
  };

  function t(key: MessageKey, params?: Params): string {
    const rawCount = params?.count;
    const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : null;
    let template = lookup(catalogs[locale], key, count);
    if (template === undefined) {
      template = lookup(catalogs['en-GB'], key, count);
      warnOnce(key, `[i18n] missing key "${key}" in locale "${locale}"`);
    }
    if (template === undefined) return key;
    return interpolate(template, params, (name) =>
      warnOnce(`${key}#param`, `[i18n] missing param "${name}" for key "${key}" (${locale})`),
    );
  }

  return { locale, t };
}

export function createTranslator(locale: Locale): Translator {
  return createTranslatorWith(locale, CATALOGS, defaultWarn);
}
