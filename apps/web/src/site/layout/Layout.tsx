// The shell of every site page: skip link, header (the hidden consent banner first; then brand,
// main nav and language switch; last the hidden language suggestion), <main> (opening with the
// "still being built" notice) and footer. Plain
// composition; t and ctx go one level down.
import type { JSX, ReactNode } from 'react';
import type { SiteKey, SiteTranslator } from '@pn/i18n/site';

import type { SitePageId } from '../config';
import type { RenderContext } from '../pages';
import { ConsentBanner } from './ConsentBanner';
import { Footer } from './Footer';
import { LanguageSwitch } from './LanguageSwitch';
import { LocaleSuggestion } from './LocaleSuggestion';
import styles from './Layout.module.css';

export interface LayoutProps {
  t: SiteTranslator;
  ctx: RenderContext;
  current: SitePageId;
  children: ReactNode;
}

const NAV_ITEMS: readonly { id: SitePageId; labelKey: SiteKey }[] = Object.freeze([
  { id: 'home', labelKey: 'site.nav.home' },
  { id: 'faq', labelKey: 'site.nav.faq' },
  { id: 'contact', labelKey: 'site.nav.contact' },
]);

export function Layout(props: LayoutProps): JSX.Element {
  const { t, ctx, current, children } = props;
  const tr = t.t;
  return (
    <>
      <a href="#main" className={styles.skip}>
        {tr('site.a11y.skipToContent')}
      </a>
      <header className={styles.header}>
        <ConsentBanner t={t} />
        <div className={styles.headerRow}>
          <a className={styles.brand} href={ctx.url('home')}>
            <img src="/site/mark.svg" alt="" width="32" height="32" />
            <span>{tr('site.meta.siteName')}</span>
          </a>
          <nav className={styles.nav} aria-label={tr('site.nav.menu')}>
            <ul>
              {NAV_ITEMS.filter((item) => ctx.has(item.id)).map((item) => (
                <li key={item.id}>
                  <a
                    className={styles.navLink}
                    href={ctx.url(item.id)}
                    aria-current={item.id === current ? 'page' : undefined}
                  >
                    {tr(item.labelKey)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <LanguageSwitch t={t} ctx={ctx} current={current} />
        </div>
        <LocaleSuggestion ctx={ctx} current={current} />
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        {/* Launch week: a store page may not be public yet while the app is in review. */}
        <p className={styles.notice} role="note" data-building-notice>
          {tr('site.notice.building')}
        </p>
        {children}
      </main>
      <Footer t={t} ctx={ctx} />
    </>
  );
}
