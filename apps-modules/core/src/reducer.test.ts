import { describe, expect, it } from 'vitest';
import { reduce } from './reducer';
import { createGame } from './state';
import type { Action, State } from './types';

describe('reduce: dig', () => {
  it('digs `strength` blocks and counts the move', () => {
    const { state, events } = reduce(createGame(10), { type: 'dig', strength: 3 });
    expect(state).toEqual({ blocks: 10, score: 3, moves: 1, done: false });
    expect(events).toEqual([{ type: 'dug', amount: 3 }]);
  });

  it('digs only the blocks left and clears the board', () => {
    const start: State = { blocks: 4, score: 3, moves: 2, done: false };
    const { state, events } = reduce(start, { type: 'dig', strength: 2 });
    expect(state).toEqual({ blocks: 4, score: 4, moves: 3, done: true });
    expect(events).toEqual([{ type: 'dug', amount: 1 }, { type: 'cleared' }]);
  });

  it('ignores a dig once the board is cleared', () => {
    const done: State = { blocks: 2, score: 2, moves: 1, done: true };
    const step = reduce(done, { type: 'dig', strength: 1 });
    expect(step.state).toBe(done);
    expect(step.events).toEqual([{ type: 'ignored' }]);
  });

  it.each([0, 4, 1.5, Number.NaN])('ignores strength %d', (strength) => {
    const start = createGame(5);
    const step = reduce(start, { type: 'dig', strength } as unknown as Action);
    expect(step.state).toBe(start);
    expect(step.events).toEqual([{ type: 'ignored' }]);
  });
});

describe('reduce: restart', () => {
  it('returns to the start of the same board', () => {
    const mid: State = { blocks: 7, score: 5, moves: 3, done: false };
    expect(reduce(mid, { type: 'restart' })).toEqual({
      state: { blocks: 7, score: 0, moves: 0, done: false },
      events: [],
    });
  });
});

describe('reduce: unknown actions', () => {
  it('ignores them and keeps the state', () => {
    const start = createGame(3);
    const step = reduce(start, { type: 'blast' } as unknown as Action);
    expect(step.state).toBe(start);
    expect(step.events).toEqual([{ type: 'ignored' }]);
  });
});
