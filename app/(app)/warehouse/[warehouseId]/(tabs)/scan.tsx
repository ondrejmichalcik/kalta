// ============================================================================
// Kalta – QR scanner
// Fullscreen camera, detect QR → getBoxByQr → navigate to detail
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getBoxByQr } from '@/src/lib/supabase';
import { showAlert } from '@/src/lib/feedback';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [processing, setProcessing] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  // Debounce: expo-camera fires onBarcodeScanned on every frame. We keep the
  // last handled code in a ref so we don't re-open it.
  const lastCodeRef = useRef<string | null>(null);

  // Pause camera when tab is not focused — saves battery + prevents
  // background barcode firing when on another tab.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const handleCode = async (code: string) => {
    if (processing || lastCodeRef.current === code) return;
    lastCodeRef.current = code;
    setProcessing(true);
    try {
      const box = await getBoxByQr(code);
      if (!box) {
        showAlert('Unknown QR code', 'This box is not in your warehouse.', [
          {
            text: 'OK',
            onPress: () => {
              lastCodeRef.current = null;
              setProcessing(false);
            },
          },
        ]);
        return;
      }
      // Use the box's own warehouse_id — scanning a QR in another shared
      // warehouse's tab should still open the correct scope.
      router.replace(`/warehouse/${box.warehouse_id}/box/${box.id}` as any);
    } catch (e: any) {
      showAlert('Error', e?.message ?? 'Cannot load box.', [
        {
          text: 'OK',
          onPress: () => {
            lastCodeRef.current = null;
            setProcessing(false);
          },
        },
      ]);
    }
  };

  // ---- Permission states ----
  if (!permission) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.hint}>Preparing camera…</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Icon brand="camera" size={96} style={styles.permIcon} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permText}>
          Kalta needs camera access to scan box QR codes.
        </Text>
        <Pressable style={styles.btnPrimary} onPress={requestPermission}>
          <Text style={styles.btnPrimaryText}>Allow camera</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {isFocused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => handleCode(data)}
        />
      )}
      {/* Viewfinder overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.overlayText}>
          {processing ? 'Loading box…' : 'Point at a box QR code'}
        </Text>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  hint: {
    ...typography.subhead,
    color: colors.textMuted,
  },
  permTitle: {
    ...typography.title2,
    color: colors.text,
    marginBottom: spacing.md,
  },
  permIcon: { marginBottom: spacing.lg },
  permText: {
    ...typography.subhead,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
  },
  btnPrimaryText: {
    ...typography.bodyStrong,
    color: colors.textOnPrimary,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    width: 260,
    height: 260,
    borderRadius: radius.xxl,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  overlayText: {
    ...typography.callout,
    color: '#FFFFFF',
    fontWeight: '600',
    marginTop: spacing.xl,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
});
