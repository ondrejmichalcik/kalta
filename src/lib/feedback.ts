// ============================================================================
// Kalta – In-app feedback (toasts + dialogs)
// Replaces the native `Alert.alert` look with a themed, design-system-aligned
// surface. Two primitives:
//   • toast.success/error/info(message)  — non-blocking, auto-dismissing
//   • showAlert(title, message?, buttons?) — blocking themed dialog, a drop-in
//     replacement for Alert.alert (same (title, message, buttons) signature)
//   • confirm({...}) — promise-based convenience over showAlert
//
// Imperative API backed by a tiny external store so it can be called from
// anywhere (event handlers, async callbacks, non-component modules). A single
// <FeedbackHost /> mounted at the root subscribes and renders the UI.
// ============================================================================

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
  text: string;
  style?: DialogButtonStyle;
  // Receives the text-field value when the dialog is a prompt (undefined for
  // plain dialogs).
  onPress?: (value?: string) => void;
}

export interface PromptConfig {
  placeholder?: string;
  defaultValue?: string;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  secureTextEntry?: boolean;
}

export interface DialogState {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  // Present → render a single-line text field; button onPress gets its value.
  prompt?: PromptConfig;
}

// --- Store ------------------------------------------------------------------
let toasts: ToastItem[] = [];
let dialog: DialogState | null = null;
let seq = 1;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function subscribeFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToastsSnapshot(): ToastItem[] {
  return toasts;
}

export function getDialogSnapshot(): DialogState | null {
  return dialog;
}

// --- Toasts -----------------------------------------------------------------
function pushToast(tone: ToastTone, message: string) {
  const item: ToastItem = { id: seq++, tone, message };
  // Cap the stack so a burst can't fill the screen.
  toasts = [...toasts, item].slice(-3);
  emit();
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (message: string) => pushToast('success', message),
  error: (message: string) => pushToast('error', message),
  info: (message: string) => pushToast('info', message),
};

// --- Dialog -----------------------------------------------------------------
/**
 * Drop-in replacement for React Native's `Alert.alert`. Renders a themed
 * modal card instead of the system alert. With no buttons, shows a single
 * "OK". Button `onPress` fires after the dialog dismisses.
 */
export function showAlert(title: string, message?: string, buttons?: DialogButton[]) {
  dialog = {
    id: seq++,
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
  };
  emit();
}

/**
 * Drop-in replacement for React Native's `Alert.prompt` (iOS). Renders a
 * themed dialog with a single-line text field; each button's onPress receives
 * the entered text. `Alert.prompt(title, msg, buttons, type, defaultValue)`
 * maps to `showPrompt(title, msg, buttons, { defaultValue })`.
 */
export function showPrompt(
  title: string,
  message?: string,
  buttons?: DialogButton[],
  prompt?: PromptConfig,
) {
  dialog = {
    id: seq++,
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
    prompt: prompt ?? {},
  };
  emit();
}

export function dismissDialog() {
  dialog = null;
  emit();
}

/** Called by the host when a dialog button is tapped. */
export function resolveDialogButton(button: DialogButton, value?: string) {
  dismissDialog();
  button.onPress?.(value);
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

/** Promise-based confirm built on showAlert — resolves true on confirm. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    showAlert(opts.title, opts.message, [
      { text: opts.cancelText ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: opts.confirmText ?? 'OK',
        style: opts.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
