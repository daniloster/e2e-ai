// Sign in to the notes (fixture API). Same testIDs as the web app, so one Gherkin feature drives both.
import type React from 'react';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '../app/AppProvider';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { login } from '../services/notesApi';
import { RADIUS, spacing, type, UI_COLORS } from '../theme';

export function SignInScreen(): React.JSX.Element {
  const { dispatch, t } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);

  const submit = () => {
    setFailed(false);
    login(email, password).then(
      r =>
        dispatch({
          type: 'SIGNED_IN',
          session: { token: r.token, email: r.user.email },
        }),
      () => setFailed(true),
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={t('notes.signInTitle')}
        onBack={() => dispatch({ type: 'NAVIGATE', screen: 'home' })}
      />
      <View style={styles.body}>
        <Text style={styles.label}>{t('notes.email')}</Text>
        <TextInput
          testID="signin-email"
          accessibilityLabel={t('notes.email')}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
        <Text style={styles.label}>{t('notes.password')}</Text>
        <TextInput
          testID="signin-password"
          accessibilityLabel={t('notes.password')}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />
        {failed && (
          <Text testID="signin-error" accessibilityRole="alert" style={styles.error}>
            {t('notes.signInFailed')}
          </Text>
        )}
        <Button testID="signin-submit" label={t('notes.signIn')} onPress={submit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_COLORS.bg },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: { ...type.label },
  input: {
    ...type.body,
    borderWidth: 1,
    borderColor: UI_COLORS.muted,
    borderRadius: RADIUS,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  error: { ...type.body, color: UI_COLORS.danger },
});
