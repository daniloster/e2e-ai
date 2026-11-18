// Guards the copy style guide (ARCHITECTURE.md §5 "Copy style"): British spelling, the product
// name, the shared terms table and the button shape.
import { describe, expect, it } from 'vitest';

import type { Catalog, Locale, MessageKey } from '../types';
import { SUPPORTED_LOCALES } from '../types';
import { CATALOGS } from '../translator';
import {
  ARTICLE,
  MAX_BUTTON_CODE_POINTS,
  PRODUCT_NAME,
  americanSpelling,
  buttonShapeOffenders,
  misspelledProductName,
} from './terminologyRules';

const catalogs: Readonly<Record<Locale, Catalog>> = CATALOGS;

/** Tappable buttons: short verb + noun, no leading article. Add every new button key here. */
const BUTTON_KEYS: readonly MessageKey[] = [
  'common.ok',
  'common.cancel',
  'common.back',
  'home.play',
  'home.settings',
  'play.dig',
  'play.undo',
  'play.again',
  'play.share',
  'consent.allow',
  'consent.decline',
  'notes.open',
  'notes.signIn',
  'notes.add',
  'notes.signOut',
];

/** The terms table of ARCHITECTURE.md §5: each key holds exactly the agreed term. */
const TERMS: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  'common.back': { 'en-GB': 'Back', es: 'Volver', 'pt-BR': 'Voltar' },
  'common.cancel': { 'en-GB': 'Cancel', es: 'Cancelar', 'pt-BR': 'Cancelar' },
};

describe('British spelling', () => {
  it('flags American spellings only', () => {
    expect(americanSpelling('Pick a color')).toBe(true);
    expect(americanSpelling('Your favorite board')).toBe(true);
    expect(americanSpelling('Canceled')).toBe(true);
    expect(americanSpelling('Pick a colour, your favourite, centre')).toBe(false);
    expect(americanSpelling('Use {color}')).toBe(false);
  });

  it('holds for every en-GB value', () => {
    const offenders = Object.entries(catalogs['en-GB'])
      .filter(([, value]) => americanSpelling(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

describe('the product name is never translated', () => {
  it('flags other casings', () => {
    expect(misspelledProductName('Welcome to pocket notes')).toBe(true);
    expect(misspelledProductName('PocketNotes')).toBe(true);
    expect(misspelledProductName(`Welcome to ${PRODUCT_NAME}`)).toBe(false);
  });

  it.each(SUPPORTED_LOCALES)('%s writes it exactly', (locale) => {
    expect(catalogs[locale]['app.name']).toBe(PRODUCT_NAME);
    const offenders = Object.entries(catalogs[locale])
      .filter(([, value]) => misspelledProductName(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

describe('agreed terms', () => {
  it.each(SUPPORTED_LOCALES)('%s uses the terms table', (locale) => {
    for (const [key, values] of Object.entries(TERMS)) {
      expect(catalogs[locale][key], key).toBe(values[locale]);
    }
  });
});

describe('buttons are short verb + noun', () => {
  it('measures length and articles as intended', () => {
    expect(MAX_BUTTON_CODE_POINTS).toBe(24);
    expect(ARTICLE['en-GB'].test('The board')).toBe(true);
    expect(ARTICLE.es.test('El juego')).toBe(true);
    expect(ARTICLE['pt-BR'].test('O jogo')).toBe(true);
    expect(buttonShapeOffenders('en-GB', { k: 'x'.repeat(25) }, ['k'])).toHaveLength(1);
    expect(buttonShapeOffenders('en-GB', {}, ['k'])).toEqual(['k: missing']);
  });

  it('lists only existing keys', () => {
    expect(BUTTON_KEYS.filter((key) => !(key in catalogs['en-GB']))).toEqual([]);
  });

  it.each(SUPPORTED_LOCALES)('%s buttons fit and start with no article', (locale) => {
    expect(buttonShapeOffenders(locale, catalogs[locale], BUTTON_KEYS)).toEqual([]);
  });
});
