// A small floating "working" pill over the screen for slow work (loading, sharing). It appears only
// after 300 ms and then stays at least 600 ms, so quick work shows nothing and slow work never
// flickers. Touches pass through it.
import type React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { RADIUS, spacing, type, UI_COLORS } from '../theme';
import { useDelayedVisibility } from './useDelayedVisibility';

export function FloatingLoader(props: {
  visible: boolean;
  /** Visible and spoken text, e.g. t('common.loading'). */
  label: string;
}): React.JSX.Element | null {
  const shown = useDelayedVisibility(props.visible);
  if (!shown) return null;
  return (
    <View style={styles.layer} pointerEvents="none">
      <View
        testID="floating-loader"
        style={styles.pill}
        accessibilityRole="progressbar"
        accessibilityLabel={props.label}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator color={UI_COLORS.primary} />
        <Text style={styles.label}>{props.label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: spacing.xxl * 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: RADIUS * 3,
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.line,
  },
  label: type.body,
});
