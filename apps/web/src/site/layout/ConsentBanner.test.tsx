// Consent banner markup: hidden, non-modal dialog, labelled, translated.
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator, SITE_CATALOGS } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import { ConsentBanner } from './ConsentBanner';

function render(locale: Locale) {
  const html = renderToStaticMarkup(<ConsentBanner t={createSiteTranslator(locale)} />);
  return { html, doc: new DOMParser().parseFromString(html, 'text/html') };
}

describe('ConsentBanner', () => {
  it.each<Locale>(['en-GB', 'es', 'pt-BR'])(
    'renders the hidden, labelled dialog in %s',
    (locale) => {
      const { html, doc } = render(locale);
      const copy = SITE_CATALOGS[locale];
      const section = doc.querySelector('section[data-consent-banner]')!;
      expect(section).not.toBeNull();
      expect(section.getAttribute('role')).toBe('dialog');
      expect(section.hasAttribute('hidden')).toBe(true);
      expect(html).toContain('hidden=""');
      const title = doc.getElementById(section.getAttribute('aria-labelledby')!)!;
      const body = doc.getElementById(section.getAttribute('aria-describedby')!)!;
      expect(title.tagName).toBe('H2');
      expect(title.id).toBe('consent-title');
      expect(title.textContent).toBe(copy['site.consent.title']);
      expect(body.tagName).toBe('P');
      expect(body.id).toBe('consent-body');
      expect(body.textContent).toBe(copy['site.consent.body']);
      const buttons = [...section.querySelectorAll('button')];
      expect(buttons.map((b) => [b.type, b.dataset.consent, b.textContent])).toEqual([
        ['button', 'accept', copy['site.consent.accept']],
        ['button', 'decline', copy['site.consent.decline']],
      ]);
      expect(html).not.toContain('aria-modal');
      expect(html).not.toContain('<a');
      expect(html.toLowerCase()).not.toContain('tabindex');
    },
  );

  it('uses the approved copy', () => {
    const en = render('en-GB').html;
    expect(en).toContain('<h2 id="consent-title">Analytics cookies</h2>');
    expect(en.indexOf('Allow analytics')).toBeLessThan(en.indexOf('No thanks'));
    const pt = render('pt-BR').html;
    for (const text of ['Cookies de análise', 'Permitir análise', 'Não, obrigado']) {
      expect(pt).toContain(text);
    }
    const es = render('es').html;
    for (const text of ['Cookies de análisis', 'No, gracias']) expect(es).toContain(text);
  });
});
