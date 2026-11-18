// The app's binding to @pn/i18n (en-GB source, es, pt-BR): the device locale and the `t` function
// screens read from the app context.
import { createTranslator, negotiateLocale } from '@pn/i18n';
import type { Locale, MessageKey, Params } from '@pn/i18n';

export type { Locale, MessageKey } from '@pn/i18n';
export { isLocale, LOCALES } from '@pn/i18n';

export type TFunction = (key: MessageKey, params?: Params) => string;

/** Any en-* → en-GB, any pt-* → pt-BR, any es-* → es; everything else en-GB. */
export function deviceLocale(): Locale {
  try {
    return negotiateLocale([Intl.DateTimeFormat().resolvedOptions().locale]);
  } catch {
    return negotiateLocale([]);
  }
}

export function createT(locale: Locale): TFunction {
  const translator = createTranslator(locale);
  return function t(key, params) {
    return translator.t(key, params);
  };
}
