import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reduce } from './reducer';
import { replay } from './replay';
import { createGame } from './state';
import { actionArb, deepFreeze, smallBlocksArb } from './testing/fixtures';
import type { State } from './types';

function checkInvariants(state: State): void {
  expect(state.score).toBeGreaterThanOrEqual(0);
  expect(state.score).toBeLessThanOrEqual(state.blocks);
  expect(state.done).toBe(state.score === state.blocks);
  expect(state.moves).toBeLessThanOrEqual(state.score);
}

const runArb = fc.record({
  blocks: smallBlocksArb,
  actions: fc.array(actionArb, { maxLength: 60 }),
});

describe('reduce (properties)', () => {
  it('keeps its invariants and never mutates its input', () => {
    fc.assert(
      fc.property(runArb, ({ blocks, actions }) => {
        let state = deepFreeze(createGame(blocks));
        for (const action of actions) {
          const { state: next, events } = reduce(state, action);
          const dug = events.reduce((sum, e) => sum + (e.type === 'dug' ? e.amount : 0), 0);
          if (action.type === 'dig') expect(next.score - state.score).toBe(dug);
          expect(events.some((e) => e.type === 'cleared')).toBe(!state.done && next.done);
          state = deepFreeze(next);
          checkInvariants(state);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('replays the same actions to identical states', () => {
    fc.assert(
      fc.property(runArb, ({ blocks, actions }) => {
        expect(replay(blocks, actions)).toEqual(replay(blocks, actions));
      }),
      { numRuns: 300 },
    );
  });
});
