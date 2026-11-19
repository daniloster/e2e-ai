import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { matchesSearch, normalizeForSearch, searchNotes } from './search';

const notes = [
  { title: 'Buy milk', description: 'Semi-skimmed' },
  { title: 'Call the plumber' },
  { title: 'Café receipts', description: null },
  { title: 'Bread', description: 'Wholemeal bread' },
];

describe('searchNotes', () => {
  it('matches titles regardless of case', () => {
    expect(searchNotes(notes, 'PLUMBER').map((n) => n.title)).toEqual(['Call the plumber']);
  });

  it('matches descriptions', () => {
    expect(searchNotes(notes, 'wholemeal').map((n) => n.title)).toEqual(['Bread']);
  });

  it('ignores accents and extra spaces', () => {
    expect(searchNotes(notes, '  cafe ').map((n) => n.title)).toEqual(['Café receipts']);
    expect(searchNotes(notes, 'buy   milk').map((n) => n.title)).toEqual(['Buy milk']);
  });

  it('returns every note for an empty query and none when nothing matches', () => {
    expect(searchNotes(notes, '   ')).toEqual(notes);
    expect(searchNotes(notes, 'taxes')).toEqual([]);
  });

  it('keeps the original order and never adds notes', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ title: fc.string(), description: fc.option(fc.string()) })), fc.string(), (list, q) => {
        const found = searchNotes(list, q);
        expect(found.every((n) => list.includes(n))).toBe(true);
        expect(found).toEqual(list.filter((n) => matchesSearch(n, q)));
      }),
    );
  });

  it('a note always matches its own title', () => {
    fc.assert(fc.property(fc.string(), (title) => matchesSearch({ title }, title)));
  });
});

describe('normalizeForSearch', () => {
  it('lower-cases, strips accents and collapses spaces', () => {
    expect(normalizeForSearch('  Ação  Rápida ')).toBe('acao rapida');
  });
});
