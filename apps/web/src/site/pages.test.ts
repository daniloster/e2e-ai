// @vitest-environment node
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { SITE_PAGES, createRenderContext, type SitePageDef } from './pages';

const faqOnly: SitePageDef = {
  id: 'faq',
  template: 'faq.html',
  slug: 'faq',
  titleKey: 'site.faq.metaTitle',
  descriptionKey: 'site.faq.metaDescription',
  render: () => createElement('main'),
};

describe('SITE_PAGES', () => {
  it('registers every page in order', () => {
    expect(SITE_PAGES.map((p) => [p.id, p.slug, p.template])).toEqual([
      ['home', '', 'index.html'],
      ['faq', 'faq', 'faq.html'],
      ['contact', 'contact', 'contact.html'],
      ['support', 'support', 'support.html'],
      ['yourData', 'your-data', 'your-data.html'],
      ['get', 'get', 'get.html'],
      ['share', 's', 's.html'],
    ]);
    expect(Object.isFrozen(SITE_PAGES)).toBe(true);
  });

  it('keeps only /get and /s out of search', () => {
    expect(SITE_PAGES.filter((p) => p.noindex === true).map((p) => p.id)).toEqual(['get', 'share']);
  });

  it('has no TV page', () => {
    expect(SITE_PAGES.map((p) => p.slug)).not.toContain('play');
  });
});

describe('createRenderContext', () => {
  it('carries the locale and its path locale', () => {
    expect(createRenderContext('pt-BR')).toMatchObject({ locale: 'pt-BR', pathLocale: 'pt-br' });
    expect(createRenderContext('en-GB').pathLocale).toBe('');
  });

  it('builds root-relative and absolute URLs, in the context locale by default', () => {
    const ctx = createRenderContext('es');
    expect(ctx.url('home')).toBe('/es/');
    expect(ctx.url('home', 'en-GB')).toBe('/');
    expect(ctx.url('share')).toBe('/es/s');
    expect(ctx.absoluteUrl('faq')).toBe('https://pocketnotes.app/es/faq');
    expect(ctx.absoluteUrl('home', 'pt-BR')).toBe('https://pocketnotes.app/pt-br/');
  });

  it('throws for an id with no registry entry and answers has()', () => {
    const ctx = createRenderContext('en-GB', [faqOnly]);
    expect(ctx.url('faq')).toBe('/faq');
    expect(ctx.has('faq')).toBe(true);
    expect(ctx.has('home')).toBe(false);
    expect(() => ctx.url('home')).toThrow(/home/);
    expect(() => ctx.absoluteUrl('contact')).toThrow(/contact/);
  });
});
