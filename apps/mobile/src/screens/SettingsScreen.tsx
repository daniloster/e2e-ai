// Settings: the usage statistics choice (the same one the consent sheet
// asks), the player ID with a note for test builds, and the app version.
import type React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '../app/AppProvider';
import { ScreenHeader } from '../components/ScreenHeader';
import { RADIUS, spacing, type, UI_COLORS } from '../theme';

function ToggleRow(props: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={type.body}>{props.label}</Text>
        {props.hint && <Text style={styles.hint}>{props.hint}</Text>}
      </View>
      <Switch
        testID={props.testID}
        accessibilityLabel={props.label}
        accessibilityHint={props.hint}
        value={props.value}
        onValueChange={props.onChange}
        trackColor={{ true: UI_COLORS.primary, false: UI_COLORS.line }}
        thumbColor={UI_COLORS.ink}
      />
    </View>
  );
}

export function SettingsScreen(): React.JSX.Element {
  const { state, dispatch, t, services } = useApp();
  const version = services.identity.appVersion();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={t('settings.title')}
        onBack={() => dispatch({ type: 'NAVIGATE', screen: 'home' })}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section} accessibilityRole="header">
          {t('settings.privacy')}
        </Text>
        <View style={styles.card}>
          <ToggleRow
            testID="settings-analytics"
            label={t('settings.analytics')}
            hint={t('settings.analyticsHint')}
            value={state.analyticsConsent === 'granted'}
            onChange={granted =>
              dispatch({ type: 'SET_ANALYTICS_CONSENT', granted })
            }
          />
        </View>

        <Text style={styles.section} accessibilityRole="header">
          {t('settings.player')}
        </Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={type.body}>{t('settings.playerId')}</Text>
            <Text testID="settings-player-id" style={type.mono} selectable>
              {state.playerId ?? '…'}
            </Text>
          </View>
          {state.testInstall && (
            <Text testID="settings-test-build" style={styles.note}>
              {t('settings.testBuild')}
            </Text>
          )}
        </View>
        {version.length > 0 && (
          <Text style={styles.version}>
            {t('settings.version', { version })}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_COLORS.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  section: { ...type.label, marginTop: spacing.md, textTransform: 'uppercase' },
  card: {
    borderRadius: RADIUS,
    backgroundColor: UI_COLORS.surface,
    borderWidth: 1,
    borderColor: UI_COLORS.line,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: spacing.xs },
  hint: { ...type.body, fontSize: 13, color: UI_COLORS.muted },
  note: {
    ...type.body,
    fontSize: 13,
    color: UI_COLORS.muted,
    paddingBottom: spacing.md,
  },
  version: { ...type.label, textAlign: 'center', marginTop: spacing.lg },
});
