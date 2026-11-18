// Contact: the address is shown as text (and as a mailto link), never in the catalog copy.
import type { JSX } from 'react';
import type { SiteTranslator } from '@pn/i18n/site';

import { CONTACT_EMAIL } from '../config';
import type { RenderContext } from '../pages';
import styles from './Content.module.css';

export function Contact(props: {
  t: SiteTranslator;
  ctx: RenderContext;
  /** Test seam; production callers leave it out (CONTACT_EMAIL). */
  email?: string;
}): JSX.Element {
  const { t } = props.t;
  const email = props.email ?? CONTACT_EMAIL;
  return (
    <div className={styles.page}>
      <h1>{t('site.contact.heading')}</h1>
      <p className={styles.lead}>{t('site.contact.body')}</p>
      <p>
        {t('site.contact.emailLabel')}
        {': '}
        <a className={styles.email} href={`mailto:${email}`} data-contact-email>
          {email}
        </a>
      </p>
      <p>{t('site.contact.tip')}</p>
    </div>
  );
}
