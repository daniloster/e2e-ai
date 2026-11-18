// Home: the product name, the best score, Play, and Settings in the header.
import type React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '../app/AppProvider';
import { DEFAULT_BLOCKS } from '../app/state';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { spacing, type, UI_COLORS } from '../theme';

export function HomeScreen(): React.JSX.Element {
  const { state, dispatch, t } = useApp();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton
          testID="home-settings"
          art="settings"
          label={t('home.settings')}
          onPress={() => dispatch({ type: 'NAVIGATE', screen: 'settings' })}
        />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {t('app.name')}
        </Text>
        <Text style={styles.tagline}>{t('home.tagline')}</Text>
        <Text testID="home-best" style={styles.best}>
          {state.best === null
            ? t('home.noBest')
            : t('home.best', { score: state.best })}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          testID="home-notes"
          variant="secondary"
          label={t('notes.open')}
          onPress={() =>
            dispatch({
              type: 'NAVIGATE',
              screen: state.session ? 'notes' : 'signin',
            })
          }
        />
        <Button
          testID="home-play"
          label={t('home.play')}
          onPress={() =>
            dispatch({ type: 'PLAY', blocks: DEFAULT_BLOCKS, source: 'new' })
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  title: { ...type.display, fontSize: 40, textAlign: 'center' },
  tagline: { ...type.body, color: UI_COLORS.muted, textAlign: 'center' },
  best: { ...type.label, marginTop: spacing.lg },
  actions: { padding: spacing.lg, gap: spacing.md },
});
