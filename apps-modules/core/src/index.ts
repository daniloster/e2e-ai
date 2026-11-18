// @pn/core: the pure, deterministic Board engine (ARCHITECTURE.md §4), shared by the app and the
// website (the site decodes share links).
export type { Action, GameEvent, State, Step, Strength } from './types';
export { MAX_BLOCKS, MIN_BLOCKS } from './types';
export { createGame, isValidBlocks } from './state';
export { reduce } from './reducer';
export { replay } from './replay';
export type { ShareDecodeError, ShareDecodeResult, SharePayload } from './codec';
export { CODEC_VERSION, decodeShare, encodeShare } from './codec';
