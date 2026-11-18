// The start state of a board.
import { MAX_BLOCKS, MIN_BLOCKS } from './types';
import type { State } from './types';

/** True for a whole number of blocks in MIN_BLOCKS..MAX_BLOCKS. */
export function isValidBlocks(blocks: unknown): blocks is number {
  return (
    Number.isInteger(blocks) && (blocks as number) >= MIN_BLOCKS && (blocks as number) <= MAX_BLOCKS
  );
}

/** A fresh board of `blocks` blocks. Throws a RangeError outside MIN_BLOCKS..MAX_BLOCKS. */
export function createGame(blocks: number): State {
  if (!isValidBlocks(blocks)) {
    throw new RangeError(`blocks must be a whole number from ${MIN_BLOCKS} to ${MAX_BLOCKS}`);
  }
  return Object.freeze({ blocks, score: 0, moves: 0, done: false });
}
