// Your data (Google Play's data deletion link): what Pocket Notes keeps, where, and how to remove
// it. There are no accounts and no server, so every answer is "on your phone" or "with Google, only
// if you allow it".
import type { JSX } from 'react';
import type { SiteKey, SiteTranslator } from '@pn/i18n/site';

import { CONTACT_EMAIL } from '../config';
import type { RenderContext } from '../pages';
import styles from './Content.module.css';

const PLACES: readonly (readonly [SiteKey, SiteKey, SiteKey])[] = Object.freeze([
  ['site.yourData.device.title', 'site.yourData.device.body', 'site.yourData.device.remove'],
  [
    'site.yourData.analytics.title',
    'site.yourData.analytics.body',
    'site.yourData.analytics.remove',
  ],
] as const);

export function YourData(props: {
  t: SiteTranslator;
  ctx: RenderContext;
  /** Test seam; production callers leave it out (CONTACT_EMAIL). */
  email?: string;
}): JSX.Element {
  const { t } = props.t;
  const email = props.email ?? CONTACT_EMAIL;
  return (
    <div className={styles.page}>
      <h1>{t('site.yourData.heading')}</h1>
      <p className={styles.lead}>{t('site.yourData.lead')}</p>
      <div className={styles.faq}>
        {PLACES.map(([title, body, remove]) => (
          <section key={title}>
            <h2>{t(title)}</h2>
            <p>{t(body)}</p>
            <p>{t(remove)}</p>
          </section>
        ))}
        <section>
          <h2>{t('site.yourData.requests.title')}</h2>
          <p>{t('site.yourData.requests.body')}</p>
          <p>
            <a className={styles.email} href={`mailto:${email}`} data-contact-email>
              {email}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
