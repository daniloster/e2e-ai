// The /get body: static markup per locale and link state.
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { SITE_CATALOGS, createSiteTranslator } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import type { StoreLinks } from '../config';
import { GetPage } from './Get';

const NONE: StoreLinks = { appStore: null, googlePlay: null };
const LIVE: StoreLinks = {
  appStore: 'https://apps.apple.com/app/id1',
  googlePlay: 'https://play.google.com/store/apps/details?id=x',
};

function render(locale: Locale, links?: StoreLinks): Document {
  const t = createSiteTranslator(locale);
  const html = renderToStaticMarkup(
    links === undefined ? <GetPage t={t} /> : <GetPage t={t} links={links} />,
  );
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('GetPage', () => {
  it.each<Locale>(['en-GB', 'es', 'pt-BR'])(
    'renders heading, line, status and coming-soon badges in %s',
    (locale) => {
      const doc = render(locale, NONE);
      const copy = SITE_CATALOGS[locale];
      expect(doc.querySelector('h1')?.textContent).toBe(copy['site.get.heading']);
      const status = doc.querySelector('[data-get-redirecting]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(status.hasAttribute('hidden')).toBe(true);
      expect(status.textContent).toBe(copy['site.get.redirecting']);
      const badges = [...doc.querySelectorAll('[data-store]')];
      expect(badges.map((b) => b.getAttribute('data-placement'))).toEqual(['page', 'page']);
      expect(doc.querySelectorAll('[data-coming-soon]')).toHaveLength(2);
    },
  );

  it('links both stores once they are live', () => {
    const doc = render('en-GB', LIVE);
    expect([...doc.querySelectorAll('a[data-store]')].map((a) => a.getAttribute('href'))).toEqual([
      LIVE.appStore,
      LIVE.googlePlay,
    ]);
  });
});
