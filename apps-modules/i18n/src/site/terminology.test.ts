// Copy style guide (ARCHITECTURE.md §5 "Copy style") over SITE_CATALOGS: British spelling, the
// product name, no domain in copy, and the button shape.
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_NAME,
  americanSpelling,
  buttonShapeOffenders,
  misspelledProductName,
} from '../locales/terminologyRules';
import { SUPPORTED_LOCALES as LOCALES } from '../types';
import { SITE_BUTTON_KEYS, SITE_CATALOGS } from './index';

describe('site: British spelling', () => {
  it('holds for every en-GB site value', () => {
    const offenders = Object.entries(SITE_CATALOGS['en-GB'])
      .filter(([, value]) => americanSpelling(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

describe('site: the product name', () => {
  it.each(LOCALES)('%s writes it exactly and never translates it', (locale) => {
    expect(SITE_CATALOGS[locale]['site.meta.siteName']).toBe(PRODUCT_NAME);
    const offenders = Object.entries(SITE_CATALOGS[locale])
      .filter(([, value]) => misspelledProductName(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

describe('site: no domain or address in copy', () => {
  it.each(LOCALES)('%s holds no URL, domain or email', (locale) => {
    const offenders = Object.entries(SITE_CATALOGS[locale])
      .filter(([, value]) => /https?:|www\.|\.(com|app)\b|@/i.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

describe('site: buttons are short verb + noun', () => {
  it('flags long and article-led buttons', () => {
    expect(
      buttonShapeOffenders('en-GB', { k: 'The best puzzle game ever made' }, ['k']),
    ).not.toEqual([]);
    expect(buttonShapeOffenders('es', { k: 'El juego' }, ['k'])).not.toEqual([]);
  });

  it('lists only existing keys', () => {
    const missing = SITE_BUTTON_KEYS.filter((key) => !(key in SITE_CATALOGS['en-GB']));
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s site buttons fit and start with no article', (locale) => {
    expect(buttonShapeOffenders(locale, SITE_CATALOGS[locale], SITE_BUTTON_KEYS)).toEqual([]);
  });
});
