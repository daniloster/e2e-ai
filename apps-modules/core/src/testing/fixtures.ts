// fast-check arbitraries and helpers shared by the property tests (excluded from coverage).
import fc from 'fast-check';
import { MAX_BLOCKS, MIN_BLOCKS } from '../types';
import type { Action, Strength } from '../types';

export const blocksArb = fc.integer({ min: MIN_BLOCKS, max: MAX_BLOCKS });

export const smallBlocksArb = fc.integer({ min: MIN_BLOCKS, max: 40 });

export const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 9,
    arbitrary: fc
      .constantFrom<Strength>(1, 2, 3)
      .map((strength) => ({ type: 'dig' as const, strength })),
  },
  { weight: 1, arbitrary: fc.constant({ type: 'restart' as const }) },
);

/** Freezes `value` and everything reachable from it, so a mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
