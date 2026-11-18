// The /s#<payload> landing: client/share.ts reads the fragment, tries the app's custom scheme
// and reveals the store fallback. Without the script the page still offers the stores.
import type { JSX } from 'react';
import type { SiteTranslator } from '@pn/i18n/site';

import { APP_SCHEME, STORE_LINKS, type StoreLinks } from '../config';
import type { RenderContext } from '../pages';
import { Button } from '../ui/Button';
import { StoreBadges } from '../ui/StoreBadges';
import styles from './Content.module.css';

export function ShareLanding(props: {
  t: SiteTranslator;
  ctx: RenderContext;
  links?: StoreLinks;
}): JSX.Element {
  const { t } = props.t;
  return (
    <div className={styles.page}>
      <h1>{t('site.share.heading')}</h1>
      <p className={styles.lead}>{t('site.share.body')}</p>
      <p data-share-opening role="status" hidden className={styles.status}>
        {t('site.share.opening')}
      </p>
      <p data-share-invalid hidden className={styles.invalid}>
        {t('site.share.invalid')}
      </p>
      <p data-share-open hidden className={styles.open}>
        <Button href={`${APP_SCHEME}://s`} data-share-app-link>
          {t('site.share.open')}
        </Button>
      </p>
      <p>{t('site.share.noApp')}</p>
      <StoreBadges t={props.t} links={props.links ?? STORE_LINKS} placement="page" />
    </div>
  );
}
