// The text button: solid amber (primary), outlined (secondary) or quiet (ghost).
import type React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { MIN_TOUCH, RADIUS, spacing, type, UI_COLORS } from '../theme';

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const variant = props.variant ?? 'primary';
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        props.disabled && styles.disabled,
        props.style,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.primaryLabel : styles.otherLabel,
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH + 8,
    paddingHorizontal: spacing.lg,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: UI_COLORS.primary },
  secondary: {
    borderWidth: 2,
    borderColor: UI_COLORS.primary,
    backgroundColor: 'transparent',
  },
  ghost: { backgroundColor: UI_COLORS.surface },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
  label: { ...type.button, textTransform: 'uppercase' },
  primaryLabel: { color: UI_COLORS.primaryInk },
  otherLabel: { color: UI_COLORS.ink },
});
