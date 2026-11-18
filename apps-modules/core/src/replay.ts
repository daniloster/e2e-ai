// Replay: the move list is the proof. A left fold of reduce from the start state.
import { reduce } from './reducer';
import { createGame } from './state';
import type { Action, State } from './types';

/** Runs `actions` from a fresh board of `blocks`. Throws a RangeError on an invalid count. */
export function replay(blocks: number, actions: readonly Action[]): State {
  let state = createGame(blocks);
  for (const action of actions) state = reduce(state, action).state;
  return state;
}
