import { createT, deviceLocale, LOCALES } from './i18n';

describe('app i18n', () => {
  it('resolves the device locale to a supported one', () => {
    expect(LOCALES).toContain(deviceLocale());
  });

  it('translates with parameters and plurals', () => {
    const t = createT('en-GB');
    expect(t('home.best', { score: 12 })).toBe('Best score: 12');
    expect(t('play.blocksLeft', { count: 1 })).toBe('1 block left');
    expect(t('play.blocksLeft', { count: 0 })).toBe('No blocks left');
    expect(createT('pt-BR')('home.play')).toBe('Jogar');
  });
});
