// Markup of the site UI parts Button and Section. Literals are test-only.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { Section } from './Section';

function parse(element: ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(element), 'text/html');
}

describe('Button', () => {
  it('renders one <a> with the href, children and data-* attributes', () => {
    const doc = parse(
      <Button href="/play" data-site-cta="play">
        x
      </Button>,
    );
    const links = doc.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/play');
    expect(links[0]?.getAttribute('data-site-cta')).toBe('play');
    expect(links[0]?.textContent).toBe('x');
  });

  it('forwards rel and aria attributes and keeps a passed className', () => {
    const doc = parse(
      <Button href="/x" variant="secondary" rel="noopener" aria-label="y" className="extra">
        x
      </Button>,
    );
    const link = doc.querySelector('a');
    expect(link?.getAttribute('rel')).toBe('noopener');
    expect(link?.getAttribute('aria-label')).toBe('y');
    expect(link?.classList.contains('extra')).toBe(true);
    expect(link?.hasAttribute('variant')).toBe(false);
  });

  it('never renders an empty class token', () => {
    const html = renderToStaticMarkup(<Button href="/x">x</Button>);
    expect(html).not.toMatch(/class="\s|\s"|\s\s/);
  });
});

describe('Section', () => {
  it('labels the section with its heading when both id and heading are given', () => {
    const doc = parse(
      <Section id="faq" heading="Q">
        <p>a</p>
      </Section>,
    );
    const section = doc.querySelector('section');
    expect(section?.id).toBe('faq');
    expect(section?.getAttribute('aria-labelledby')).toBe('faq-title');
    const h2 = section?.querySelector('h2');
    expect(h2?.id).toBe('faq-title');
    expect(h2?.textContent).toBe('Q');
    expect(section?.querySelector('h2, h3, h1')).toBe(h2);
    expect(h2?.nextElementSibling?.tagName).toBe('P');
  });

  it('renders a heading without id or label when no id is given', () => {
    const section = parse(<Section heading="Q">a</Section>).querySelector('section');
    expect(section?.hasAttribute('aria-labelledby')).toBe(false);
    expect(section?.hasAttribute('id')).toBe(false);
    expect(section?.querySelector('h2')?.hasAttribute('id')).toBe(false);
  });

  it('renders no heading when none is given, in any tone', () => {
    const section = parse(
      <Section id="x" tone="raised">
        a
      </Section>,
    ).querySelector('section');
    expect(section?.querySelector('h2')).toBeNull();
    expect(section?.hasAttribute('aria-labelledby')).toBe(false);
    expect(section?.textContent).toBe('a');
  });
});
