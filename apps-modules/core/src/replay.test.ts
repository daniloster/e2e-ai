import { describe, expect, it } from 'vitest';
import { replay } from './replay';

describe('replay', () => {
  it('folds the actions from a fresh board', () => {
    expect(
      replay(5, [
        { type: 'dig', strength: 2 },
        { type: 'dig', strength: 3 },
        { type: 'dig', strength: 1 },
      ]),
    ).toEqual({ blocks: 5, score: 5, moves: 2, done: true });
  });

  it('returns the start state for an empty list', () => {
    expect(replay(3, [])).toEqual({ blocks: 3, score: 0, moves: 0, done: false });
  });

  it('throws on an invalid board', () => {
    expect(() => replay(0, [])).toThrow(RangeError);
  });
});
