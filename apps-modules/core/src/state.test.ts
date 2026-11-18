import { describe, expect, it } from 'vitest';
import { createGame, isValidBlocks } from './state';
import { MAX_BLOCKS, MIN_BLOCKS } from './types';

describe('createGame', () => {
  it('starts an untouched board', () => {
    const state = createGame(5);
    expect(state).toEqual({ blocks: 5, score: 0, moves: 0, done: false });
    expect(Object.isFrozen(state)).toBe(true);
  });

  it.each([MIN_BLOCKS, MAX_BLOCKS])('accepts %i blocks', (blocks) => {
    expect(createGame(blocks).blocks).toBe(blocks);
  });

  it.each([0, -1, MAX_BLOCKS + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %d blocks',
    (blocks) => {
      expect(() => createGame(blocks)).toThrow(RangeError);
    },
  );
});

describe('isValidBlocks', () => {
  it('accepts only whole numbers in range', () => {
    expect(isValidBlocks(10)).toBe(true);
    expect(isValidBlocks('10')).toBe(false);
    expect(isValidBlocks(null)).toBe(false);
  });
});
