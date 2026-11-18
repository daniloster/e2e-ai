// Board: the game model. A board holds `blocks` blocks; each dig removes 1 to 3 of them and the
// board is cleared when every block is dug. Pure data, shared by the app and the website.

/** Fewest and most blocks a board can hold (also the codec's range). */
export const MIN_BLOCKS = 1;
export const MAX_BLOCKS = 999;

export type Strength = 1 | 2 | 3;

export interface State {
  /** Blocks the board started with. */
  readonly blocks: number;
  /** Blocks dug so far (0..blocks). */
  readonly score: number;
  /** Accepted digs since the start or the last restart. */
  readonly moves: number;
  /** True once every block is dug; later digs are ignored. */
  readonly done: boolean;
}

export type Action =
  { readonly type: 'dig'; readonly strength: Strength } | { readonly type: 'restart' };

export type GameEvent =
  | { readonly type: 'dug'; readonly amount: number }
  | { readonly type: 'cleared' }
  | { readonly type: 'ignored' };

export interface Step {
  readonly state: State;
  readonly events: readonly GameEvent[];
}
