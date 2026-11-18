// @vitest-environment jsdom
// Source checks of the static pages served outside the site templates (404.html): legal.css colours
// and focus ring, and the site chrome's parity with the site catalog.
import { cssVariables } from '@pn/design-tokens';
import { createSiteTranslator } from '@pn/i18n/site';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Vite's ?raw import: under jsdom import.meta.url is not a file: URL, so fileURLToPath cannot read it.
import NOT_FOUND_HTML from '../public/404.html?raw';

// CSS ?raw imports depend on the Vite css config, so the stylesheet is read from disk; the tests
// run from the repo root (npm test) or from apps/web.
const LEGAL_CSS_PATH = ['apps/web/public/legal.css', 'public/legal.css']
  .map((path) => join(process.cwd(), path))
  .find((path) => existsSync(path));
const LEGAL_CSS = LEGAL_CSS_PATH ? readFileSync(LEGAL_CSS_PATH, 'utf8') : '';

const TOKEN_NAMES = new Set(
  Object.keys(cssVariables()).filter((name) => name.startsWith('--color-')),
);
const ALL_TOKENS = new Set(Object.keys(cssVariables()));
const SYSTEM_COLOURS = new Set([
  'Canvas',
  'CanvasText',
  'LinkText',
  'GrayText',
  'Highlight',
  'HighlightText',
  'Mark',
  'MarkText',
  'transparent',
  'currentColor',
]);
const COLOUR_PROPERTIES =
  /^(color|background|background-color|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|text-decoration-color|fill|stroke|caret-color|accent-color|box-shadow)$/;
// Non-colour words allowed next to a token in a colour declaration (widths, styles, keywords).
const NON_COLOUR_WORD = /^(-?\d*\.?\d+(px|rem|em|%)?|solid|dashed|dotted|none|inherit|underline)$/;
const COLOUR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/g;
const TOKEN_USE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*?)\s*)?\)/g;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function declarations(css) {
  return [...stripComments(css).matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({
    property: m[1],
    value: m[2].trim(),
  }));
}

// Every colour problem in a stylesheet, as readable strings ([] when clean).
function colourProblems(css) {
  const problems = [...stripComments(css).matchAll(COLOUR_LITERAL)].map(
    (m) => `colour literal ${m[1]}`,
  );
  for (const { property, value } of declarations(css)) {
    for (const [, name, fallback] of value.matchAll(TOKEN_USE)) {
      if (!name.startsWith('--color-')) {
        if (!ALL_TOKENS.has(name)) problems.push(`${property}: unknown token ${name}`);
        continue;
      }
      if (!TOKEN_NAMES.has(name)) problems.push(`${property}: unknown token ${name}`);
      if (fallback === undefined) problems.push(`${property}: ${name} has no fallback`);
      else if (!SYSTEM_COLOURS.has(fallback))
        problems.push(`${property}: ${name} fallback ${fallback} is not a system colour`);
    }
    if (property.startsWith('--color-')) problems.push(`declares ${property}`);
    if (!COLOUR_PROPERTIES.test(property)) continue;
    const rest = value.replace(TOKEN_USE, ' ').trim();
    for (const word of rest.split(/\s+/).filter(Boolean)) {
      if (!NON_COLOUR_WORD.test(word) && !SYSTEM_COLOURS.has(word) && word !== 'inherit') {
        problems.push(`${property}: ${value} is not a token colour`);
      }
    }
  }
  return problems;
}

describe('legal.css', () => {
  const css = stripComments(LEGAL_CSS);

  it('uses only design-token colours with system-colour fallbacks', () => {
    expect(LEGAL_CSS).toContain('.placeholder');
    expect(TOKEN_NAMES.size).toBeGreaterThan(0);
    expect(colourProblems(LEGAL_CSS)).toEqual([]);
  });

  it('the scan names literals, missing fallbacks and unknown tokens', () => {
    expect(colourProblems('a { color: #fff; }')).toContain('colour literal #fff');
    expect(colourProblems('a { background: rgb(0 0 0); }')).toContain('colour literal rgb(');
    expect(colourProblems('a { color: var(--color-ink); }')).toEqual([
      'color: --color-ink has no fallback',
    ]);
    expect(colourProblems('a { color: var(--color-gold, Canvas); }')).toEqual([
      'color: unknown token --color-gold',
    ]);
    expect(colourProblems('a { color: var(--color-ink, red); }')).toEqual([
      'color: --color-ink fallback red is not a system colour',
    ]);
    expect(colourProblems('a { color: red; }')).toEqual(['color: red is not a token colour']);
    expect(colourProblems('a { font-family: var(--font-nope, serif); }')).toEqual([
      'font-family: unknown token --font-nope',
    ]);
  });

  it('keeps the light/dark scheme, the body font with system fallbacks and no prefers-color-scheme', () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark;/);
    expect(css.replace(/\s+/g, ' ')).toContain(
      "var(--font-body, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)",
    );
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('has a 3px focus ring and never removes the outline', () => {
    expect(css).toMatch(
      /:focus-visible\s*\{\s*outline:\s*3px solid var\(--color-primary, Highlight\);\s*outline-offset:\s*3px;/,
    );
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it('keeps the .placeholder highlight', () => {
    expect(css).toMatch(
      /\.placeholder\s*\{\s*background:\s*var\(--color-primary, Mark\);\s*color:\s*var\(--color-primary-ink, MarkText\);/,
    );
  });

  it('has no @import and no color-mix()', () => {
    expect(css).not.toContain('@import');
    expect(css).not.toContain('color-mix(');
  });
});

const LOCALES = ['en-GB', 'es', 'pt-BR'];
const PREFIX = { 'en-GB': '/', es: '/es/', 'pt-BR': '/pt-br/' };
const CHROME_PAGES = [
  { file: '404.html', html: NOT_FOUND_HTML, page: '404', footer: false },
];
const HEAD_RESOURCES = [
  'icon /site/favicon.svg',
  'icon /site/favicon-32.png',
  'apple-touch-icon /site/apple-touch-icon.png',
  'stylesheet /legal.css',
  'stylesheet /site/tokens.css',
  'script /legal.js',
];
// [key, slug] of the header links, in the site Layout's order.
const HEADER_LINKS = [
  ['site.nav.home', ''],
  ['site.nav.faq', 'faq'],
  ['site.nav.contact', 'contact'],
];
const FOOTER_LINKS = [
  ['site.nav.contact', (l) => `${PREFIX[l]}contact`],
  ['site.nav.support', (l) => `${PREFIX[l]}support`],
  ['site.nav.yourData', (l) => `${PREFIX[l]}your-data`],
];
const CHROME_SELECTOR =
  '[data-site-key], [data-site-label-key], [data-i18n-en-gb], [data-href-en-gb], [data-label-en-gb]';

function parse(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function suffix(locale) {
  return locale.toLowerCase();
}

function t(locale, key) {
  return createSiteTranslator(locale).t(key);
}

function headResources(doc) {
  return [...doc.head.querySelectorAll('link, script')].map((el) =>
    el.tagName === 'SCRIPT'
      ? `script ${el.getAttribute('src')}`
      : `${el.getAttribute('rel')} ${el.getAttribute('href')}`,
  );
}

describe.each(CHROME_PAGES)('site chrome: $file', ({ file, html, page, footer }) => {
  const doc = parse(html);

  it('is an en-GB document linking the favicons, legal.css, tokens.css, then legal.js', () => {
    expect(doc.documentElement.lang).toBe('en-GB');
    const canonical = page === '404' ? [] : [`canonical https://pocketnotes.app/${page}`];
    expect(headResources(doc)).toEqual([...canonical, ...HEAD_RESOURCES]);
    const description = doc.querySelector('meta[name="description"]');
    if (page === '404') expect(description).toBeNull();
    else expect(description.getAttribute('content')).toMatch(/Pocket Notes/);
  });

  it('starts the body with the skip link, then the header with brand and the menu links', () => {
    const [skip, header] = doc.body.children;
    expect(skip.getAttribute('href')).toBe('#main');
    expect(header.matches('header[data-site-header]')).toBe(true);
    const brand = header.querySelector('a.brand');
    expect(brand.textContent).toBe('Pocket Notes');
    expect(brand.querySelector('img').getAttribute('src')).toBe('/site/mark.svg');
    const links = [...header.querySelectorAll('nav a')];
    expect(links.map((a) => a.getAttribute('data-site-key'))).toEqual(
      HEADER_LINKS.map((r) => r[0]),
    );
    links.forEach((link, i) => {
      const slug = HEADER_LINKS[i][1];
      expect(link.getAttribute('href')).toBe(`/${slug}`);
      for (const locale of LOCALES) {
        expect(link.getAttribute(`data-href-${suffix(locale)}`)).toBe(`${PREFIX[locale]}${slug}`);
      }
    });
  });

  it('marks main as the skip target and offers every language', () => {
    const main = doc.querySelector('main');
    expect(main.id).toBe('main');
    expect(main.getAttribute('data-legal-page')).toBe(page);
    const langs = [...main.querySelectorAll('nav[data-legal-langs] a')];
    expect(langs.map((a) => a.getAttribute('hreflang'))).toEqual(LOCALES);
    expect(langs.map((a) => a.getAttribute('href'))).toEqual(LOCALES.map((l) => `?lang=${l}`));
    expect(langs.map((a) => a.textContent)).toEqual(
      LOCALES.map((l) => t(l, `site.lang.name.${l}`)),
    );
  });

  it(`${footer ? 'has' : 'has no'} the site footer after main`, () => {
    const foot = doc.querySelector('footer[data-site-footer]');
    if (!footer) {
      expect(foot).toBeNull();
      return;
    }
    expect(doc.querySelector('main').nextElementSibling).toBe(foot);
    const links = [...foot.querySelectorAll('ul > li > a')];
    expect(links.map((a) => a.getAttribute('data-site-key'))).toEqual(
      FOOTER_LINKS.map((r) => r[0]),
    );
    links.forEach((link, i) => {
      const [key, url] = FOOTER_LINKS[i];
      expect(link.getAttribute('href'), `${file} ${key}`).toBe(url('en-GB'));
      for (const locale of LOCALES) {
        expect(link.getAttribute(`data-href-${suffix(locale)}`), `${file} ${key} ${locale}`).toBe(
          url(locale),
        );
      }
    });
    expect(foot.querySelector(':scope > p').getAttribute('data-site-key')).toBe(
      'site.footer.tagline',
    );
  });

  it('every chrome label equals the site catalog in every locale', () => {
    const texts = [...doc.querySelectorAll('[data-site-key]')];
    const labels = [...doc.querySelectorAll('[data-site-label-key]')];
    expect(texts.length).toBeGreaterThan(0);
    expect(labels.length).toBeGreaterThan(0);
    for (const el of texts) {
      const key = el.getAttribute('data-site-key');
      expect(el.textContent, `${file} ${key} en-GB text`).toBe(t('en-GB', key));
      for (const locale of LOCALES) {
        expect(el.getAttribute(`data-i18n-${suffix(locale)}`), `${file} ${key} ${locale}`).toBe(
          t(locale, key),
        );
      }
    }
    for (const el of labels) {
      const key = el.getAttribute('data-site-label-key');
      expect(el.getAttribute('aria-label'), `${file} ${key} en-GB label`).toBe(t('en-GB', key));
      for (const locale of LOCALES) {
        expect(el.getAttribute(`data-label-${suffix(locale)}`), `${file} ${key} ${locale}`).toBe(
          t(locale, key),
        );
      }
    }
  });

  it('keeps the chrome out of the articles, with no inline script or style', () => {
    const articles = [...doc.querySelectorAll('article[data-locale]')];
    expect(articles.map((a) => a.getAttribute('data-locale'))).toEqual(LOCALES);
    for (const article of articles) {
      expect(article.id).toBe(article.getAttribute('data-locale'));
      expect(article.lang).toBe(article.getAttribute('data-locale'));
      expect(article.getAttribute('data-title')).toMatch(/ - Pocket Notes$/);
      expect(article.querySelectorAll(CHROME_SELECTOR)).toHaveLength(0);
    }
    expect(doc.querySelectorAll('script:not([src])')).toHaveLength(0);
    expect(doc.querySelectorAll('[style]')).toHaveLength(0);
    expect(doc.querySelectorAll('style')).toHaveLength(0);
    expect(doc.getElementById('root')).toBeNull();
    expect(doc.title).toBe(
      doc.querySelector('article[data-locale="en-GB"]').getAttribute('data-title'),
    );
  });

  it('names no TV page, no Host Pass and no other domain', () => {
    expect(html).not.toMatch(/\/play\b|host pass|\bTV\b/i);
    const hosts = [...html.matchAll(/https:\/\/([\w.-]+)/g)].map((m) => m[1]);
    const allowed = /(^|\.)(pocketnotes\.app|cloudflare\.com|google\.com|apple\.com)$/;
    expect(hosts.filter((h) => !allowed.test(h))).toEqual([]);
  });
});

describe('site chrome: shared header', () => {
  it('404.html shows the not-found copy and links home in every locale', () => {
    const doc = parse(NOT_FOUND_HTML);
    for (const article of doc.querySelectorAll('article[data-locale]')) {
      const locale = article.getAttribute('data-locale');
      expect(article.getAttribute('data-title')).toBe(
        `${t(locale, 'site.notFound.title')} - Pocket Notes`,
      );
      expect(article.querySelector('h1').textContent).toBe(t(locale, 'site.notFound.title'));
      expect(article.querySelector('p').textContent).toBe(t(locale, 'site.notFound.body'));
      const links = [...article.querySelectorAll('a')];
      expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
        [PREFIX[locale], t(locale, 'site.notFound.home')],
      ]);
    }
  });
});
