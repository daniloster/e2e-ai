// createSiteTranslator: lookup, interpolation, closed SiteKey; plural and fallback equal createTranslatorWith.
import { describe, expect, it, vi } from 'vitest';

import { createSiteTranslator } from '@pn/i18n/site';
import { createTranslatorWith } from '../translator';
import type { Catalog, Locale, MessageKey } from '../types';
import type { SiteKey } from './siteTranslator';
import { SITE_CATALOGS, createSiteTranslatorWith } from './siteTranslator';

const FIXTURE: Readonly<Record<Locale, Catalog>> = {
  'en-GB': {
    'site.fixture.players_zero': 'No players',
    'site.fixture.players_one': '{count} player',
    'site.fixture.players_other': '{count} players',
    'site.fixture.only': 'Only in English',
  },
  es: {
    'site.fixture.players_zero': 'Ningún jugador',
    'site.fixture.players_one': '{count} jugador',
    'site.fixture.players_other': '{count} jugadores',
  },
  'pt-BR': {
    'site.fixture.players_zero': 'Nenhum jogador',
    'site.fixture.players_one': '{count} jogador',
    'site.fixture.players_other': '{count} jogadores',
  },
};
const PLAYERS = 'site.fixture.players';

describe('createSiteTranslator', () => {
  it('returns the locale value', () => {
    for (const locale of ['en-GB', 'es', 'pt-BR'] as const) {
      expect(createSiteTranslator(locale).t('site.meta.defaultTitle')).toBe(
        SITE_CATALOGS[locale]['site.meta.defaultTitle'],
      );
    }
  });

  it('interpolates params', () => {
    expect(createSiteTranslator('en-GB').t('site.footer.rights', { year: 2026 })).toBe(
      '© 2026 Pocket Notes',
    );
  });

  it('rejects unknown keys at compile time', () => {
    const { t } = createSiteTranslator('en-GB');
    // @ts-expect-error SiteKey is closed: 'site.nope' is not a site catalog key.
    expect(t('site.nope')).toBe('site.nope');
  });
});

describe('createSiteTranslatorWith', () => {
  it.each(['en-GB', 'pt-BR'] as const)('%s plurals equal createTranslatorWith', (locale) => {
    const site = createSiteTranslatorWith(locale, FIXTURE, vi.fn());
    const main = createTranslatorWith(locale, FIXTURE, vi.fn());
    for (const count of [0, 1, 2]) {
      expect(site.t(PLAYERS as SiteKey, { count })).toBe(main.t(PLAYERS as MessageKey, { count }));
    }
  });

  it('falls back to en-GB and warns once', () => {
    const warn = vi.fn();
    const { t } = createSiteTranslatorWith('es', FIXTURE, warn);
    expect(t('site.fixture.only' as SiteKey)).toBe('Only in English');
    expect(t('site.fixture.only' as SiteKey)).toBe('Only in English');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
