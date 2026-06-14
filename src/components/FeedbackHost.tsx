// ============================================================================
// Kalta – FeedbackHost
// Renders the in-app toast stack + themed dialog backed by src/lib/feedback.
// Mounted once at the root (app/_layout.tsx) above the navigator so it overlays
// every screen. See feedback.ts for the imperative API (toast.*, showAlert,
// confirm).
// ============================================================================
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  dismissToast,
  getDialogSnapshot,
  getToastsSnapshot,
  resolveDialogButton,
  subscribeFeedback,
  type DialogButton,
  type ToastItem,
  type ToastTone,
} from '@/src/lib/feedback';
import { colors, radius, shadows, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

const TOAST_DURATION = 2600;

const TONE_META: Record<ToastTone, { sf: string; color: string; bg: string }> = {
  success: { sf: 'checkmark.circle.fill', color: colors.success, bg: colors.successBg },
  error: { sf: 'exclamationmark.triangle.fill', color: colors.danger, bg: colors.dangerBg },
  info: { sf: 'info.circle.fill', color: colors.info, bg: colors.infoBg },
};

function ToastView({ item }: { item: ToastItem }) {
  const anim = useRef(new Animated.Value(0)).current;
  const meta = TONE_META[item.tone];

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      bounciness: 6,
      speed: 14,
    }).start();
    const t = setTimeout(hide, TOAST_DURATION);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hide = () => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => dismissToast(item.id));
  };

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
          ],
        },
      ]}
    >
      <Pressable style={styles.toastInner} onPress={hide}>
        <View style={[styles.toastIcon, { backgroundColor: meta.bg }]}>
          <Icon sf={meta.sf as any} size={16} color={meta.color} />
        </View>
        <Text style={styles.toastText} numberOfLines={3}>
          {item.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function buttonTextColor(style: DialogButton['style']): string {
  if (style === 'destructive') return colors.textOnPrimary;
  if (style === 'cancel') return colors.text;
  return colors.textOnPrimary;
}

function DialogButtonView({ button, onPress }: { button: DialogButton; onPress: () => void }) {
  const isCancel = button.style === 'cancel';
  const isDestructive = button.style === 'destructive';
  return (
    <Pressable
      style={({ pressed }) => [
        styles.dialogBtn,
        isCancel
          ? styles.dialogBtnCancel
          : isDestructive
            ? styles.dialogBtnDestructive
            : styles.dialogBtnDefault,
        pressed && { opacity: 0.8 },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.dialogBtnText, { color: buttonTextColor(button.style) }]}>
        {button.text}
      </Text>
    </Pressable>
  );
}

function DialogView() {
  const dialog = useSyncExternalStore(subscribeFeedback, getDialogSnapshot);
  const anim = useRef(new Animated.Value(0)).current;
  const [value, setValue] = useState('');

  useEffect(() => {
    if (dialog) {
      setValue(dialog.prompt?.defaultValue ?? '');
      anim.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 5,
        speed: 16,
      }).start();
    }
  }, [dialog, anim]);

  if (!dialog) return null;

  // Two buttons → side by side; one or 3+ → stacked full-width rows.
  const sideBySide = dialog.buttons.length === 2;
  const isPrompt = !!dialog.prompt;

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.dialogOverlay}>
        <Animated.View
          style={[
            styles.dialogCard,
            {
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              ],
            },
          ]}
        >
          <Text style={styles.dialogTitle}>{dialog.title}</Text>
          {!!dialog.message && <Text style={styles.dialogMessage}>{dialog.message}</Text>}
          {isPrompt && (
            <TextInput
              style={styles.dialogInput}
              value={value}
              onChangeText={setValue}
              placeholder={dialog.prompt?.placeholder}
              placeholderTextColor={colors.textSubtle}
              keyboardType={dialog.prompt?.keyboardType ?? 'default'}
              secureTextEntry={dialog.prompt?.secureTextEntry}
              autoFocus
              autoCapitalize="sentences"
            />
          )}
          <View style={[styles.dialogBtnRow, sideBySide ? styles.dialogBtnRowH : styles.dialogBtnRowV]}>
            {dialog.buttons.map((b, i) => (
              <View key={`${b.text}-${i}`} style={sideBySide ? { flex: 1 } : undefined}>
                <DialogButtonView
                  button={b}
                  onPress={() => resolveDialogButton(b, isPrompt ? value : undefined)}
                />
              </View>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function FeedbackHost() {
  const toasts = useSyncExternalStore(subscribeFeedback, getToastsSnapshot);
  const insets = useSafeAreaInsets();

  return (
    <>
      <View pointerEvents="box-none" style={[styles.toastLayer, { top: insets.top + spacing.sm }]}>
        {toasts.map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </View>
      <DialogView />
    </>
  );
}

const styles = StyleSheet.create({
  // --- Toasts ---
  toastLayer: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    zIndex: 1000,
  },
  toast: {
    width: '100%',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.lg,
  },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  toastIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: { ...typography.subhead, color: colors.text, flex: 1, fontWeight: '500' },

  // --- Dialog ---
  dialogOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.lg,
  },
  dialogTitle: { ...typography.headline, color: colors.text, textAlign: 'center' },
  dialogMessage: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  dialogInput: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.md,
  },
  dialogBtnRow: { marginTop: spacing.lg },
  dialogBtnRowH: { flexDirection: 'row', gap: spacing.sm },
  dialogBtnRowV: { flexDirection: 'column', gap: spacing.sm },
  dialogBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  dialogBtnDefault: { backgroundColor: colors.primary },
  dialogBtnDestructive: { backgroundColor: colors.danger },
  dialogBtnCancel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  dialogBtnText: { ...typography.bodyStrong },
});
