// The icon-only button every header and toolbar uses: a 36 pt square showing one PNG from the
// generated UI art (src/brand/ui, tinted with tintColor), with a 44 pt touch area (hitSlop) and a
// spoken label. Never draw icons with text glyphs or emoji: add the art to tools/brand's `ui` target.
import type React from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { UI_ART, UI_ART_SIZE } from '../brand/ui';
import type { UiArt } from '../brand/ui';
import { MIN_TOUCH, RADIUS, UI_COLORS } from '../theme';

export const ICON_BUTTON_SIZE = 36;
const SLOP = (MIN_TOUCH - ICON_BUTTON_SIZE) / 2;

export function IconButton(props: {
  art: UiArt;
  /** What a screen reader says: the full action ("Back", "Share this board"). */
  label: string;
  onPress: () => void;
  /** Ink colour by default; the art is a glyph, so any token colour works. */
  tint?: string;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const size = UI_ART_SIZE[props.art];
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      hitSlop={SLOP}
      onPress={() => {
        props.onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        pressed && styles.pressed,
        props.disabled && styles.disabled,
        props.style,
      ]}
    >
      <Image
        source={UI_ART[props.art]}
        style={[size, { tintColor: props.tint ?? UI_COLORS.ink }]}
        resizeMode="contain"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: UI_COLORS.surface },
  disabled: { opacity: 0.4 },
});
