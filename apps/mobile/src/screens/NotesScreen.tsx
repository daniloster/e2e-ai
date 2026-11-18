// The signed-in user's notes: add, tick done, delete, sign out. Same testIDs as the web app.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '../app/AppProvider';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { addNote, listNotes, removeNote, setDone, type Note } from '../services/notesApi';
import { RADIUS, spacing, type, UI_COLORS } from '../theme';

export function NotesScreen(): React.JSX.Element {
  const { state, dispatch, t } = useApp();
  const token = state.session?.token ?? '';
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    listNotes(token).then(setNotes, () => setFailed(true));
  }, [token]);
  useEffect(reload, [reload]);

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    addNote(token, title).then(() => {
      setDraft('');
      reload();
    }, () => setFailed(true));
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={t('notes.title')}
        right={
          <Button
            testID="notes-signout"
            variant="ghost"
            label={t('notes.signOut')}
            onPress={() => dispatch({ type: 'SIGN_OUT' })}
          />
        }
      />
      <View style={styles.body}>
        <Text testID="notes-user" style={styles.muted}>
          {t('notes.signedInAs', { email: state.session?.email ?? '' })}
        </Text>
        <View style={styles.row}>
          <TextInput
            testID="notes-new"
            accessibilityLabel={t('notes.newLabel')}
            placeholder={t('notes.newPlaceholder')}
            placeholderTextColor={UI_COLORS.muted}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            style={styles.input}
          />
          <Button testID="notes-add" label={t('notes.add')} onPress={add} />
        </View>
        {failed && <Text accessibilityRole="alert">{t('notes.loadFailed')}</Text>}
        {notes !== null && notes.length === 0 && (
          <Text testID="notes-empty" style={styles.muted}>
            {t('notes.empty')}
          </Text>
        )}
        {notes !== null && notes.length > 0 && (
          <Text testID="notes-count" style={styles.muted}>
            {t('notes.count', { count: notes.length })}
          </Text>
        )}
        <FlatList
          data={notes ?? []}
          keyExtractor={n => n.id}
          renderItem={({ item }) => (
            <View testID={`note-row-${item.id}`} role="listitem" style={styles.item}>
              <Pressable
                testID={`note-done-${item.id}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={item.title}
                onPress={() => setDone(token, item.id, !item.done).then(reload)}
                style={styles.check}
              >
                <View style={[styles.box, item.done && styles.boxOn]} />
                <View style={styles.texts}>
                  <Text style={[styles.title, item.done && styles.titleDone]}>
                    {item.title}
                  </Text>
                  {item.description ? (
                    <Text testID={`note-description-${item.id}`} style={styles.muted}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                testID={`note-delete-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={t('notes.deleteA11y', { title: item.title })}
                onPress={() => removeNote(token, item.id).then(reload)}
                hitSlop={12}
              >
                <Text style={styles.muted}>✕</Text>
              </Pressable>
            </View>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_COLORS.bg },
  body: { flex: 1, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    ...type.body,
    flex: 1,
    borderWidth: 1,
    borderColor: UI_COLORS.muted,
    borderRadius: RADIUS,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  muted: { ...type.body, color: UI_COLORS.muted },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: UI_COLORS.muted },
  boxOn: { backgroundColor: UI_COLORS.muted },
  texts: { flex: 1 },
  title: { ...type.body },
  titleDone: { textDecorationLine: 'line-through', color: UI_COLORS.muted },
});
