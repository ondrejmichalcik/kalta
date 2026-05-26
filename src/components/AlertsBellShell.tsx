// ============================================================================
// Kalta – AlertsBellShell
// Reusable bell-in-header + dropdown-panel skeleton extracted so both the
// global (Warehouses root) and per-warehouse bells share the same animation,
// caret, backdrop, and "fly out of bell / tuck back in" behaviour. Callers
// supply the alert summary (controls dot color + visibility) and the cards
// that render inside the panel.
// ============================================================================
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing } from '@/src/theme';
import { Icon } from './Icon';

export type AlertTone = 'red' | 'amber' | 'sage';

const TONE_RANK: Record<AlertTone, number> = { red: 3, amber: 2, sage: 1 };
const TONE_COLOR: Record<AlertTone, string> = {
  red: colors.danger,
  amber: colors.warning,
  sage: colors.primary,
};

export function worstTone(tones: AlertTone[]): AlertTone {
  return tones.reduce<AlertTone>(
    (acc, t) => (TONE_RANK[t] > TONE_RANK[acc] ? t : acc),
    'sage',
  );
}

const HEADER_HEIGHT = 64;
const OPEN_DURATION = 240;
const CLOSE_DURATION = 180;

interface Props {
  /** Render `null` when there's nothing to alert about — bell stays hidden. */
  tone: AlertTone | null;
  /** Used for VoiceOver. */
  alertCount: number;
  /** Number of header action icons rendered to the right of the bell. Drives
   *  the caret position so the tip lands on the bell. Defaults to 2 (the
   *  Boxes-tab layout: search + filter). */
  actionsAfterBell?: number;
  /** Content of the dropdown panel — usually one or more cards. Should call
   *  `close()` (passed below) before navigating away to play the tuck-back
   *  animation. */
  renderPanel: (close: () => void) => ReactNode;
}

// caret tip is on the bell center; numbers come from ListHeader layout:
// spacing.lg right padding (16) + N × (action btn 40 + spacing.sm gap 8) +
// half bell (22) − half caret (8) = 14 + 48·N
function caretOffsetFor(actionsAfterBell: number): number {
  return 16 + actionsAfterBell * 48 + 14;
}

export function AlertsBellShell({ tone, alertCount, actionsAfterBell = 2, renderPanel }: Props) {
  const insets = useSafeAreaInsets();
  // `intent` = what the user wants. `mounted` = whether the Modal is in the
  // tree. Separating the two lets the close animation finish before the
  // Modal unmounts (otherwise the panel pops out instantly).
  const [intent, setIntent] = useState<'open' | 'closed'>('closed');
  const [mounted, setMounted] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (intent === 'open') {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_DURATION,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [intent, mounted, progress]);

  if (!tone) return null;

  const close = () => setIntent('closed');
  const toggle = () => setIntent((i) => (i === 'open' ? 'closed' : 'open'));

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 1] });
  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.25],
  });

  return (
    <>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.5 }]}
        accessibilityLabel={`${alertCount} alert${alertCount === 1 ? '' : 's'}`}
      >
        <Icon sf="bell.fill" size={20} color={colors.text} />
        <View style={[styles.dot, { backgroundColor: TONE_COLOR[tone] }]} />
      </Pressable>

      <Modal visible={mounted} transparent animationType="none" onRequestClose={close}>
        <Pressable style={styles.backdropTouch} onPress={close}>
          <Animated.View
            style={[styles.backdrop, { opacity: backdropOpacity }]}
            pointerEvents="none"
          />
        </Pressable>

        <Animated.View
          style={[
            styles.panel,
            {
              top: insets.top + HEADER_HEIGHT,
              opacity,
              transform: [{ translateY }, { scale }],
              transformOrigin: 'top right',
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={[styles.caret, { marginRight: caretOffsetFor(actionsAfterBell) }]} />
          <View style={styles.panelInner}>{renderPanel(close)}</View>
        </Animated.View>
      </Modal>
    </>
  );
}

/** Helper used by callers that need to navigate after the close animation. */
export function delayedRoute(close: () => void, navigate: () => void) {
  close();
  setTimeout(navigate, CLOSE_DURATION);
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.background,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'stretch',
  },
  caret: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.background,
    alignSelf: 'flex-end',
    // marginRight set at render time via caretOffsetFor(actionsAfterBell)
  },
  panelInner: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 0,
    ...shadows.lg,
  },
});
