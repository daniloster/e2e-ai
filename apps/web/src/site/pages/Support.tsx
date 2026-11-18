// Support (the App Store "Support URL"): what the app runs on, answers to the common problems and
// the contact address, which is shown as text and as a mailto link, never in the catalog copy.
import type { JSX } from 'react';
import type { SiteKey, SiteTranslator } from '@pn/i18n/site';

import { CONTACT_EMAIL } from '../config';
import type { RenderContext } from '../pages';
import styles from './Content.module.css';

const TOPICS: readonly (readonly [SiteKey, SiteKey])[] = Object.freeze([
  ['site.support.devices.title', 'site.support.devices.body'],
  ['site.support.link.title', 'site.support.link.body'],
  ['site.support.progress.title', 'site.support.progress.body'],
] as const);

export function Support(props: {
  t: SiteTranslator;
  ctx: RenderContext;
  /** Test seam; production callers leave it out (CONTACT_EMAIL). */
  email?: string;
}): JSX.Element {
  const { t } = props.t;
  const { ctx } = props;
  const email = props.email ?? CONTACT_EMAIL;
  return (
    <div className={styles.page}>
      <h1>{t('site.support.heading')}</h1>
      <p className={styles.lead}>{t('site.support.lead')}</p>
      <div className={styles.faq}>
        {TOPICS.map(([title, body]) => (
          <section key={title}>
            <h2>{t(title)}</h2>
            <p>{t(body)}</p>
          </section>
        ))}
        <section>
          <h2>{t('site.support.contact.title')}</h2>
          <p>{t('site.support.contact.body')}</p>
          <p>
            <a className={styles.email} href={`mailto:${email}`} data-contact-email>
              {email}
            </a>
          </p>
        </section>
        <section>
          <h2>{t('site.support.more.title')}</h2>
          <ul>
            {ctx.has('faq') && (
              <li>
                <a href={ctx.url('faq')}>{t('site.nav.faq')}</a>
              </li>
            )}
            {ctx.has('yourData') && (
              <li>
                <a href={ctx.url('yourData')}>{t('site.nav.yourData')}</a>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
