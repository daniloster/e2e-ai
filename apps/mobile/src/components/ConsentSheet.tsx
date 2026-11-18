// The usage statistics and crash reports question, asked once while the choice is unknown. Allow and
// No thanks are equally prominent and nothing is preselected; either answer closes it.
import type React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../app/AppProvider';
import { RADIUS, spacing, type, UI_COLORS } from '../theme';
import { Button } from './Button';

// The privacy policy is linked from Settings and the store listing; add a link here if your legal
// review asks for one at the moment of choice.
export function ConsentSheet(props: { visible: boolean }): React.JSX.Element {
  const { dispatch, t } = useApp();
  const choose = (granted: boolean) =>
    dispatch({ type: 'SET_ANALYTICS_CONSENT', granted });
  return (
    // Android back keeps the question open: only an answer closes it.
    <Modal
      transparent
      animationType="fade"
      visible={props.visible}
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {t('consent.title')}
          </Text>
          <Text style={styles.body}>{t('consent.description')}</Text>
          {/* The same style for both answers: neither is nudged. */}
          <View style={styles.actions}>
            <Button
              testID="consent-deny"
              variant="secondary"
              label={t('consent.decline')}
              onPress={() => choose(false)}
              style={styles.action}
            />
            <Button
              testID="consent-allow"
              variant="secondary"
              label={t('consent.allow')}
              onPress={() => choose(true)}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(20,24,31,0.85)',
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: RADIUS,
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.line,
  },
  title: type.title,
  body: type.body,
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: { flex: 1 },
});
