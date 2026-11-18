// The pure reducer (ARCHITECTURE.md §4): reduce(state, action) -> { state, events }. It never
// mutates its input, reads no clock and has no randomness, so a replay always reaches the same
// state. Events drive presentation: the UI maps them to animations and sounds and never re-derives
// an outcome.
//
// Resolution order of a dig: ignored when the board is done or the strength is not 1..3; otherwise
// dig min(strength, blocks left) -> `dug`, then `cleared` when no block is left.
import type { Action, GameEvent, State, Step } from './types';

const IGNORED: readonly GameEvent[] = Object.freeze([Object.freeze({ type: 'ignored' as const })]);
const NO_EVENTS: readonly GameEvent[] = Object.freeze([]);

function isStrength(value: unknown): boolean {
  return value === 1 || value === 2 || value === 3;
}

function dig(state: State, strength: number): Step {
  if (state.done || !isStrength(strength)) return { state, events: IGNORED };
  const amount = Math.min(strength, state.blocks - state.score);
  const score = state.score + amount;
  const done = score === state.blocks;
  const events: GameEvent[] = [{ type: 'dug', amount }];
  if (done) events.push({ type: 'cleared' });
  return {
    state: Object.freeze({ blocks: state.blocks, score, moves: state.moves + 1, done }),
    events: Object.freeze(events),
  };
}

export function reduce(state: State, action: Action): Step {
  switch (action.type) {
    case 'dig':
      return dig(state, action.strength);
    case 'restart':
      return {
        state: Object.freeze({ blocks: state.blocks, score: 0, moves: 0, done: false }),
        events: NO_EVENTS,
      };
    default:
      // An unknown action from a newer build or a corrupted log: rejected, state unchanged.
      return { state, events: IGNORED };
  }
}
