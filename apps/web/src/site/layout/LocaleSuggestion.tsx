// Hidden "This page is also in …" bars, one per other locale, each written in its own language
//. client/localeSuggest.ts reveals the one matching the visitor's language.
import type { JSX } from 'react';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator, type SiteKey } from '@pn/i18n/site';

import { SITE_LOCALES, type SitePageId } from '../config';
import type { RenderContext } from '../pages';
import styles from './Layout.module.css';

const LANGUAGE_NAME_KEYS: Readonly<Record<Locale, SiteKey>> = Object.freeze({
  'en-GB': 'site.lang.name.en-GB',
  es: 'site.lang.name.es',
  'pt-BR': 'site.lang.name.pt-BR',
});

export function LocaleSuggestion(props: { ctx: RenderContext; current: SitePageId }): JSX.Element {
  const { ctx, current } = props;
  return (
    <>
      {SITE_LOCALES.filter((locale) => locale !== ctx.locale).map((locale) => {
        const { t } = createSiteTranslator(locale);
        return (
          <div
            key={locale}
            data-locale-suggestion={locale}
            lang={locale}
            hidden
            className={styles.localeSuggestion}
          >
            <p>{t('site.lang.suggest', { language: t(LANGUAGE_NAME_KEYS[locale]) })}</p>
            <a href={ctx.url(current, locale)} hrefLang={locale} lang={locale} data-locale-switch>
              {t('site.lang.switch')}
            </a>
            <button type="button" data-locale-dismiss>
              {t('site.lang.dismiss')}
            </button>
          </div>
        );
      })}
    </>
  );
}
