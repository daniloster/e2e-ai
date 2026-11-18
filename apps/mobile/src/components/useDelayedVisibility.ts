// Show/hide timing for loaders: nothing for quick work, and no flicker for slow work. Shown only once
// `visible` has been true for `delayMs`, then kept for at least `minMs` after it appeared.
import { useEffect, useRef, useState } from 'react';

export const LOADER_DELAY_MS = 300;
export const LOADER_MIN_MS = 600;

export function useDelayedVisibility(
  visible: boolean,
  delayMs: number = LOADER_DELAY_MS,
  minMs: number = LOADER_MIN_MS,
): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (visible && !shown) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }
    if (!visible && shown) {
      const left = Math.max(0, minMs - (Date.now() - shownAt.current));
      const timer = setTimeout(() => setShown(false), left);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visible, shown, delayMs, minMs]);
  return shown;
}
