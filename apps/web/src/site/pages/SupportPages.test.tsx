// /support and /your-data: every section per locale, the contact address and the links out.
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { SITE_CATALOGS, createSiteTranslator } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import { CONTACT_EMAIL, SITE_LOCALES } from '../config';
import { createRenderContext } from '../pages';
import { Support } from './Support';
import { YourData } from './YourData';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function headings(doc: Document): string[] {
  return [...doc.querySelectorAll('h2')].map((h) => h.textContent ?? '');
}

describe('Support', () => {
  it.each(SITE_LOCALES)('%s lists the topics, the address and the help links', (locale) => {
    const copy = SITE_CATALOGS[locale as Locale];
    const ctx = createRenderContext(locale);
    const doc = parse(renderToStaticMarkup(<Support t={createSiteTranslator(locale)} ctx={ctx} />));
    expect(doc.querySelector('h1')?.textContent).toBe(copy['site.support.heading']);
    expect(headings(doc)).toEqual([
      copy['site.support.devices.title'],
      copy['site.support.link.title'],
      copy['site.support.progress.title'],
      copy['site.support.contact.title'],
      copy['site.support.more.title'],
    ]);
    expect(doc.querySelector('[data-contact-email]')?.getAttribute('href')).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
    expect([...doc.querySelectorAll('ul a')].map((a) => a.getAttribute('href'))).toEqual([
      ctx.url('faq'),
      ctx.url('yourData'),
    ]);
  });

  it('takes a test address and leaves out unregistered pages', () => {
    const ctx = { ...createRenderContext('en-GB'), has: () => false };
    const doc = parse(
      renderToStaticMarkup(
        <Support t={createSiteTranslator('en-GB')} ctx={ctx} email="test@example.org" />,
      ),
    );
    expect(doc.querySelector('[data-contact-email]')?.textContent).toBe('test@example.org');
    expect(doc.querySelectorAll('ul a')).toHaveLength(0);
  });
});

describe('YourData', () => {
  it.each(SITE_LOCALES)('%s says what is kept where and how to remove it', (locale) => {
    const copy = SITE_CATALOGS[locale as Locale];
    const doc = parse(
      renderToStaticMarkup(
        <YourData t={createSiteTranslator(locale)} ctx={createRenderContext(locale)} />,
      ),
    );
    expect(headings(doc)).toEqual([
      copy['site.yourData.device.title'],
      copy['site.yourData.analytics.title'],
      copy['site.yourData.requests.title'],
    ]);
    expect(doc.body.textContent).toContain(copy['site.yourData.device.remove']);
    expect(doc.body.textContent).toContain(copy['site.yourData.analytics.remove']);
    expect(doc.querySelector('[data-contact-email]')?.getAttribute('href')).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
    expect(doc.querySelector('a[href^="/privacy"]')).toBeNull();
  });

  it('takes a test address', () => {
    const doc = parse(
      renderToStaticMarkup(
        <YourData
          t={createSiteTranslator('en-GB')}
          ctx={createRenderContext('en-GB')}
          email="test@example.org"
        />,
      ),
    );
    expect(doc.querySelector('[data-contact-email]')?.textContent).toBe('test@example.org');
  });
});
