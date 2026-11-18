// @pn/i18n: the app catalogs (en-GB source, es, pt-BR), locale negotiation and the translator.
export type { Locale } from './types';
export { SUPPORTED_LOCALES, LOCALES, DEFAULT_LOCALE } from './types';
export { negotiateLocale, isLocale } from './negotiate';
export type { Translator, MessageKey, Params, Catalog } from './types';
export { CATALOGS, createTranslator } from './translator';
