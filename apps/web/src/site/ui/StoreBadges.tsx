// App Store and Google Play badges, live or "coming soon". client/links.ts binds them by
// data-store / data-placement. The glyphs are generic, store-neutral shapes; swap in the official
// artwork when the listings go live.
import type { JSX } from 'react';
import type { SiteTranslator } from '@pn/i18n/site';

import type { StoreLinks } from '../config';
import styles from './StoreBadges.module.css';

export type { StoreLinks } from '../config';
export type StorePlacement = 'hero' | 'footer' | 'page';

type StoreId = 'app_store' | 'google_play';

const GLYPHS: Readonly<Record<StoreId, string>> = Object.freeze({
  app_store:
    'M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4zm6 4-5 11h2.2l1-2.3h3.6l1 2.3H17L12 6zm0 4.4 1.1 2.6h-2.2L12 10.4z',
  google_play: 'M5 3.5v17a1 1 0 0 0 1.5.86l14.2-8.5a1 1 0 0 0 0-1.72L6.5 2.64A1 1 0 0 0 5 3.5z',
});

function Glyph(props: { store: StoreId }): JSX.Element {
  return (
    <svg
      className={styles.glyph}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path fillRule="evenodd" d={GLYPHS[props.store]} />
    </svg>
  );
}

function Badge(props: {
  store: StoreId;
  url: string | null;
  label: string;
  comingSoon: string;
  placement: StorePlacement;
}): JSX.Element {
  const { store, url, label, comingSoon, placement } = props;
  if (url === null) {
    // No link at all: no dead href and no focus stop.
    return (
      <span
        className={`${styles.badge ?? ''} ${styles.soon ?? ''}`.trim() || undefined}
        data-store={store}
        data-placement={placement}
        data-coming-soon=""
      >
        <Glyph store={store} />
        <span className={styles.text}>
          <span>{label}</span>
          <span className={styles.soonText}>{comingSoon}</span>
        </span>
      </span>
    );
  }
  return (
    <a
      className={styles.badge}
      href={url}
      rel="noopener"
      data-store={store}
      data-placement={placement}
    >
      <Glyph store={store} />
      <span className={styles.text}>
        <span>{label}</span>
      </span>
    </a>
  );
}

export function StoreBadges(props: {
  t: SiteTranslator;
  links: StoreLinks;
  placement: StorePlacement;
}): JSX.Element {
  const { t } = props.t;
  const comingSoon = t('site.cta.comingSoon');
  return (
    <ul className={styles.badges}>
      <li>
        <Badge
          store="app_store"
          url={props.links.appStore}
          label={t('site.cta.appStore')}
          comingSoon={comingSoon}
          placement={props.placement}
        />
      </li>
      <li>
        <Badge
          store="google_play"
          url={props.links.googlePlay}
          label={t('site.cta.googlePlay')}
          comingSoon={comingSoon}
          placement={props.placement}
        />
      </li>
    </ul>
  );
}
