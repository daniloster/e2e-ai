// Locale constants and catalog types. en-GB is the source and default locale.
export type Locale = 'en-GB' | 'es' | 'pt-BR';
export const SUPPORTED_LOCALES: readonly Locale[] = Object.freeze([
  'en-GB',
  'es',
  'pt-BR',
] as const);
/** Alias of SUPPORTED_LOCALES. */
export const LOCALES: readonly Locale[] = SUPPORTED_LOCALES;
export const DEFAULT_LOCALE: Locale = 'en-GB';

import type { enGB } from './locales/en-GB';

export type PluralSuffix = '_zero' | '_one' | '_other';
export type Catalog = Readonly<Record<string, string>>;
type StripPlural<K> = K extends `${infer Base}${PluralSuffix}` ? Base : K;
/** Every catalog key with plural suffixes removed ('play.blocks', not 'play.blocks_one'). */
export type MessageKey = StripPlural<keyof typeof enGB>;
export type Params = Readonly<Record<string, string | number>>;

export interface Translator {
  locale: Locale;
  t(key: MessageKey, params?: Params): string; // "{name}" interpolation; plural when params.count is a number
}
