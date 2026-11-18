// @vitest-environment node
// The site theme: token coverage, contrast, no colour literals, reduced motion, head <style>.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { contrastRatio, cssVariables, UI_COLORS } from '@pn/design-tokens';
import { createSiteTranslator } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import { Head } from './Head';
import { SITE_PAGES, createRenderContext, type SitePageDef } from './pages';
import { siteTokensCss, themeStyle } from './theme';

const sheets = import.meta.glob<string>(['./**/*.module.css', './site.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const COLOR_LITERAL = /:\s*[^;{}]*?(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/g;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Every colour literal in a declaration value, as 'file: match'.
function colorLiterals(files: Readonly<Record<string, string>>): string[] {
  return Object.entries(files).flatMap(([file, text]) =>
    [...stripComments(text).matchAll(COLOR_LITERAL)].map((m) => `${file}: ${m[1]!}`),
  );
}

describe('themeStyle', () => {
  const style = themeStyle();
  const vars = cssVariables();

  it('declares every UI token on :root', () => {
    const colors = Object.entries(vars).filter(([name]) => name.startsWith('--color-'));
    expect(colors).toHaveLength(Object.keys(UI_COLORS).length);
    for (const [name, value] of Object.entries(vars)) expect(style).toContain(`${name}:${value};`);
    expect(style).toContain(`--color-bg:${UI_COLORS.bg};`);
    expect(style).toContain(`--color-ink:${UI_COLORS.ink};`);
    expect(style).toContain(`--color-primary:${UI_COLORS.primary};`);
    expect(style).toMatch(/--radius:\d+px;/);
  });

  it('is one :root block that cannot close the <style>', () => {
    expect(style.startsWith(':root{')).toBe(true);
    expect(style.endsWith('}')).toBe(true);
    expect(style).not.toContain('<');
    expect(style.match(/\{/g)).toHaveLength(1);
  });
});

describe('siteTokensCss', () => {
  const css = siteTokensCss();

  it('is themeStyle() followed by the dark color-scheme rule', () => {
    expect(css.startsWith(themeStyle())).toBe(true);
    expect(css.startsWith(`:root{--color-bg:${UI_COLORS.bg};`)).toBe(true);
    expect(css.endsWith(':root{color-scheme:dark}\n')).toBe(true);
    expect(css).toBe(`${themeStyle()}\n:root{color-scheme:dark}\n`);
  });

  it('declares every --color-* token', () => {
    for (const [name, value] of Object.entries(cssVariables())) {
      if (name.startsWith('--color-')) expect(css).toContain(`${name}:${value};`);
    }
  });

  it('is safe as a standalone stylesheet', () => {
    expect(css).not.toContain('<');
    expect(css).not.toContain('</style');
  });

  it('is re-exported by the SSR entry', async () => {
    expect((await import('./server')).siteTokensCss).toBe(siteTokensCss);
  });
});

describe('UI contrast', () => {
  const c = UI_COLORS;
  it.each([
    ['ink on bg', c.ink, c.bg],
    ['muted on bg', c.muted, c.bg],
    ['ink on surface', c.ink, c.surface],
    ['primaryInk on primary', c.primaryInk, c.primary],
  ])('%s is at least 4.5:1', (_, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('the primary focus ring on bg is at least 3:1', () => {
    expect(contrastRatio(c.primary, c.bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('site stylesheets', () => {
  it('loads site.css', () => {
    expect(sheets['./site.css']).toBeDefined();
  });

  it('hold no colour literal', () => {
    expect(colorLiterals(sheets)).toEqual([]);
  });

  it('the scan names the file and the match, and ignores id selectors', () => {
    expect(colorLiterals({ './site.css': 'a { color: #fff; }' })).toEqual(['./site.css: #fff']);
    expect(colorLiterals({ './x.css': 'a { background: rgb(0 0 0); }' })).toEqual([
      './x.css: rgb(',
    ]);
    expect(colorLiterals({ './x.css': 'b { color: hsla(0 0% 0% / 1); }' })).toEqual([
      './x.css: hsla(',
    ]);
    expect(colorLiterals({ './x.css': '#main { color: var(--color-ink); } /* #fff */' })).toEqual(
      [],
    );
  });

  it('turns transitions and animations off under reduced motion', () => {
    const css = stripComments(sheets['./site.css']!);
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(css);
    expect(block).not.toBeNull();
    const body = block![1]!;
    expect(body).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    expect(body).toMatch(/transition:\s*none/);
    expect(body).toMatch(/animation:\s*none/);
  });

  it('declares no --color-* in site.css', () => {
    expect(sheets['./site.css']).not.toMatch(/--color-[\w-]+\s*:/);
  });
});

describe('Head', () => {
  it('renders exactly one <style> holding themeStyle()', () => {
    const html = renderToStaticMarkup(
      createElement(Head, {
        t: createSiteTranslator('en-GB'),
        ctx: createRenderContext('en-GB'),
        page: SITE_PAGES[0] as SitePageDef,
      }),
    );
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    expect(styles).toEqual([themeStyle()]);
  });
});
