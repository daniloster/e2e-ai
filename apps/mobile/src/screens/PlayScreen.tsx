// Play: drives @pn/core's reducer. A big tap target digs at the chosen strength; the counter shows
// what is left. The move list is kept, so Undo replays it without the last dig (the engine is
// deterministic: the same moves always reach the same state). Clearing records the best score and
// offers Undo in a toast; the header shares the board as a link.
import { createGame, reduce, replay } from '@pn/core';
import type { Action, State, Strength } from '@pn/core';
import type React from 'react';
import { useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '../app/AppProvider';
import { shareLink } from '../app/links';
import { Button } from '../components/Button';
import { FloatingLoader } from '../components/FloatingLoader';
import { IconButton } from '../components/IconButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Toast } from '../components/Toast';
import type { ToastContent } from '../components/Toast';
import { MIN_TOUCH, RADIUS, spacing, type, UI_COLORS } from '../theme';

const STRENGTHS: readonly Strength[] = [1, 2, 3];

export function PlayScreen(): React.JSX.Element {
  const { state: app, dispatch, t, services } = useApp();
  const blocks = app.play.blocks;
  const [game, setGame] = useState<State>(() => createGame(blocks));
  const [strength, setStrength] = useState<Strength>(1);
  const [toast, setToast] = useState<ToastContent | null>(null);
  const [sharing, setSharing] = useState(false);
  const moves = useRef<Action[]>([]);

  function act(action: Action) {
    const step = reduce(game, action);
    if (action.type === 'restart') moves.current = [];
    else if (!step.events.some(e => e.type === 'ignored'))
      moves.current.push(action);
    setGame(step.state);
    if (!step.events.some(e => e.type === 'cleared')) return;
    const newBest = app.best === null || step.state.score > app.best;
    dispatch({ type: 'RECORD_SCORE', score: step.state.score });
    void services.analytics.track({
      name: 'game_cleared',
      params: { moves: step.state.moves, score: step.state.score },
    });
    setToast({
      message: newBest
        ? `${t('play.cleared', { moves: step.state.moves })} ${t('play.newBest')}`
        : t('play.cleared', { moves: step.state.moves }),
      actionLabel: t('play.undo'),
      onAction: undo,
    });
  }

  function undo() {
    moves.current = moves.current.slice(0, -1);
    setGame(replay(blocks, moves.current));
  }

  async function share() {
    setSharing(true);
    try {
      await Share.share({
        message: t('play.shareMessage', { link: shareLink(blocks) }),
      });
      void services.analytics.track({
        name: 'game_shared',
        params: { blocks },
      });
    } catch (error) {
      services.analytics.recordError(error, 'share.sheet', 'share');
      setToast({ message: t('play.shareFailed') });
    } finally {
      setSharing(false);
    }
  }

  const left = game.blocks - game.score;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={t('play.title')}
        onBack={() => dispatch({ type: 'NAVIGATE', screen: 'home' })}
        right={
          <IconButton
            testID="play-share"
            art="share"
            label={t('play.share')}
            onPress={() => void share()}
          />
        }
      />
      <View style={styles.counter}>
        <Text
          testID="play-left"
          style={styles.left}
          accessibilityLiveRegion="polite"
        >
          {t('play.blocksLeft', { count: left })}
        </Text>
        <Text style={styles.stats}>
          {t('play.score', { score: game.score })} ·{' '}
          {t('play.moves', { moves: game.moves })}
        </Text>
      </View>
      <View style={styles.center}>
        <Pressable
          testID="play-dig"
          accessibilityRole="button"
          accessibilityLabel={t('play.digA11y', { count: strength })}
          accessibilityState={{ disabled: game.done }}
          disabled={game.done}
          onPress={() => {
            act({ type: 'dig', strength });
          }}
          style={({ pressed }) => [
            styles.dig,
            pressed && styles.digPressed,
            game.done && styles.digDone,
          ]}
        >
          <Text style={styles.digLabel}>{t('play.dig')}</Text>
        </Pressable>
      </View>
      <View style={styles.footer}>
        <Text style={styles.label}>{t('play.strength')}</Text>
        <View style={styles.segments} accessibilityRole="radiogroup">
          {STRENGTHS.map(s => (
            <Pressable
              key={s}
              testID={`play-strength-${s}`}
              accessibilityRole="radio"
              accessibilityLabel={t('play.strengthOption', { count: s })}
              accessibilityState={{ checked: strength === s }}
              onPress={() => {
                setStrength(s);
              }}
              style={[styles.segment, strength === s && styles.segmentOn]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  strength === s && styles.segmentLabelOn,
                ]}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
        {game.done && (
          <Button
            testID="play-again"
            label={t('play.again')}
            onPress={() => {
              setToast(null);
              act({ type: 'restart' });
            }}
          />
        )}
      </View>
      <Toast toast={toast} onHide={() => setToast(null)} />
      <FloatingLoader visible={sharing} label={t('common.loading')} />
    </SafeAreaView>
  );
}

const DIG_SIZE = 200;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_COLORS.bg },
  counter: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.lg },
  left: type.display,
  stats: { ...type.label },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dig: {
    width: DIG_SIZE,
    height: DIG_SIZE,
    borderRadius: DIG_SIZE / 2,
    backgroundColor: UI_COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digPressed: { opacity: 0.85 },
  digDone: { opacity: 0.4 },
  digLabel: { ...type.display, color: UI_COLORS.primaryInk },
  footer: { gap: spacing.md, padding: spacing.lg },
  label: { ...type.label, textAlign: 'center' },
  segments: { flexDirection: 'row', gap: spacing.sm },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: UI_COLORS.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: {
    borderColor: UI_COLORS.primary,
    backgroundColor: UI_COLORS.surface,
  },
  segmentLabel: { ...type.button, color: UI_COLORS.muted },
  segmentLabelOn: { color: UI_COLORS.primary },
});
