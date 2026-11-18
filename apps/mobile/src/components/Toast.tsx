// A short message at the bottom of the screen with an optional action (Undo, Retry). It hides itself
// after `durationMs` (longer with an action, so it can be reached) and is announced to screen readers.
// It fades in and out; under Reduce motion it appears and disappears without animation.
import type React from 'react';
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '../app/useReduceMotion';
import { MIN_TOUCH, RADIUS, spacing, type, UI_COLORS } from '../theme';

export const TOAST_MS = 3000;
export const TOAST_ACTION_MS = 6000;
const FADE_MS = 180;

export interface ToastContent {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Toast(props: {
  /** null hides the toast; a new object shows it again (and restarts its timer). */
  toast: ToastContent | null;
  onHide: () => void;
  durationMs?: number;
}): React.JSX.Element | null {
  const { toast, onHide } = props;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    if (!toast) return undefined;
    AccessibilityInfo.announceForAccessibility(toast.message);
    if (reduceMotion) opacity.setValue(1);
    else
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start();
    const ms =
      props.durationMs ?? (toast.actionLabel ? TOAST_ACTION_MS : TOAST_MS);
    const timer = setTimeout(() => onHideRef.current(), ms);
    return () => clearTimeout(timer);
  }, [toast, reduceMotion, opacity, props.durationMs]);

  if (!toast) return null;
  return (
    <View
      style={[styles.layer, { paddingBottom: insets.bottom + spacing.lg }]}
      pointerEvents="box-none"
    >
      <Animated.View
        testID="toast"
        style={[styles.card, { opacity }]}
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.message}>{toast.message}</Text>
        {toast.actionLabel && toast.onAction && (
          <Pressable
            testID="toast-action"
            accessibilityRole="button"
            hitSlop={spacing.sm}
            onPress={() => {
              toast.onAction?.();
              onHideRef.current();
            }}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{toast.actionLabel}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    minHeight: MIN_TOUCH + 8,
    borderRadius: RADIUS,
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.line,
  },
  message: { ...type.body, flex: 1, paddingVertical: spacing.sm },
  action: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    ...type.button,
    color: UI_COLORS.primary,
    textTransform: 'uppercase',
  },
});
