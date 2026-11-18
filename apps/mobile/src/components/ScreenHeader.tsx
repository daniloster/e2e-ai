// The header of every screen but Home: Back on the left, the title centred, one optional action on
// the right. Both sides keep the same width so the title stays centred with or without an action.
import type React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useApp } from '../app/AppProvider';
import { spacing, type } from '../theme';
import { ICON_BUTTON_SIZE, IconButton } from './IconButton';

export function ScreenHeader(props: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useApp();
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {props.onBack && (
          <IconButton
            testID="header-back"
            art="back"
            label={t('common.back')}
            onPress={props.onBack}
          />
        )}
      </View>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {props.title}
      </Text>
      <View style={[styles.side, styles.right]}>{props.right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  side: { width: ICON_BUTTON_SIZE, height: ICON_BUTTON_SIZE },
  right: { alignItems: 'flex-end' },
  title: { ...type.title, flex: 1, textAlign: 'center' },
});
