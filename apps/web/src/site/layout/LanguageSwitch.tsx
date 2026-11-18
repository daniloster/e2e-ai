// Links to the same page in each site locale. The endonyms are identical in every
// catalog, and lang on each link lets screen readers pronounce each one in its own language.
import type { JSX } from 'react';
import type { Locale } from '@pn/i18n';
import type { SiteKey, SiteTranslator } from '@pn/i18n/site';

import { SITE_LOCALES, type SitePageId } from '../config';
import type { RenderContext } from '../pages';
import styles from './Layout.module.css';

const LANGUAGE_NAME_KEYS: Readonly<Record<Locale, SiteKey>> = Object.freeze({
  'en-GB': 'site.lang.name.en-GB',
  es: 'site.lang.name.es',
  'pt-BR': 'site.lang.name.pt-BR',
});

export function LanguageSwitch(props: {
  t: SiteTranslator;
  ctx: RenderContext;
  current: SitePageId;
}): JSX.Element {
  const { t } = props.t;
  const { ctx, current } = props;
  return (
    <nav aria-label={t('site.lang.label')}>
      <ul className={styles.langs}>
        {SITE_LOCALES.map((locale) => (
          <li key={locale}>
            <a
              className={styles.langLink}
              href={ctx.url(current, locale)}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === ctx.locale ? 'page' : undefined}
            >
              {t(LANGUAGE_NAME_KEYS[locale])}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
