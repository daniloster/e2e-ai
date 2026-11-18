// The /get body: heading, line, the hidden redirect status client/get.ts reveals, and both store
// badges (the desktop view and the fallback when no redirect happens).
import type { JSX } from 'react';
import type { SiteTranslator } from '@pn/i18n/site';

import { STORE_LINKS, type StoreLinks } from '../config';
import type { RenderContext } from '../pages';
import { StoreBadges } from '../ui/StoreBadges';
import styles from './Get.module.css';

export function GetPage(props: {
  t: SiteTranslator;
  ctx?: RenderContext;
  links?: StoreLinks;
}): JSX.Element {
  const { t } = props.t;
  return (
    <div className={styles.get}>
      <h1>{t('site.get.heading')}</h1>
      <p>{t('site.get.body')}</p>
      <p data-get-redirecting role="status" hidden className={styles.status}>
        {t('site.get.redirecting')}
      </p>
      <StoreBadges t={props.t} links={props.links ?? STORE_LINKS} placement="page" />
    </div>
  );
}
