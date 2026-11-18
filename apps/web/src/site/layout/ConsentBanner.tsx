// The site consent banner: static, hidden, non-modal dialog translated at
// build time; client/banner.ts reveals it and records the choice. Both buttons have equal weight.
import type { JSX } from 'react';
import type { SiteTranslator } from '@pn/i18n/site';

import styles from './ConsentBanner.module.css';

export function ConsentBanner(props: { t: SiteTranslator }): JSX.Element {
  const { t } = props.t;
  return (
    <section
      data-consent-banner
      role="dialog"
      aria-labelledby="consent-title"
      aria-describedby="consent-body"
      hidden
      className={styles.banner}
    >
      <h2 id="consent-title">{t('site.consent.title')}</h2>
      <p id="consent-body">{t('site.consent.body')}</p>
      <div className={styles.actions}>
        <button type="button" data-consent="accept" className={styles.accept}>
          {t('site.consent.accept')}
        </button>
        <button type="button" data-consent="decline" className={styles.decline}>
          {t('site.consent.decline')}
        </button>
      </div>
    </section>
  );
}
