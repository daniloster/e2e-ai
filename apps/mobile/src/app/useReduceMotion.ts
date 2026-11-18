// The system "Reduce motion" setting, live. Screens keep their timings when it is on but simplify the
// motion itself (no bounce, scale or slide: a cross-fade or an instant change instead).
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (active) setReduce(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
