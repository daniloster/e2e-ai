// The site footer: page links (only for registered pages), the legal pages with ?lang=<locale>
// (public/legal.js reads it), the consent settings button, the tagline and the copyright year at
// build time.
import type { JSX } from 'react';
import type { SiteTranslator } from '@pn/i18n/site';

import type { RenderContext } from '../pages';
import styles from './Layout.module.css';

export function Footer(props: { t: SiteTranslator; ctx: RenderContext }): JSX.Element {
  const { t } = props.t;
  const { ctx } = props;
  return (
    <footer className={styles.footer}>
      <ul className={styles.footerLinks}>
        {ctx.has('contact') && (
          <li>
            <a href={ctx.url('contact')}>{t('site.nav.contact')}</a>
          </li>
        )}
        {ctx.has('support') && (
          <li>
            <a href={ctx.url('support')}>{t('site.nav.support')}</a>
          </li>
        )}
        {ctx.has('yourData') && (
          <li>
            <a href={ctx.url('yourData')}>{t('site.nav.yourData')}</a>
          </li>
        )}
      </ul>
      {/* Revealed by client/banner.ts: without the script it would do nothing. */}
      <button type="button" data-consent-settings hidden className={styles.settings}>
        {t('site.consent.settings')}
      </button>
      <p className={styles.footerNote}>{t('site.footer.tagline')}</p>
      <p className={styles.footerNote}>
        {t('site.footer.rights', { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
