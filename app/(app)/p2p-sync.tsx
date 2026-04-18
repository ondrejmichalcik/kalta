// ============================================================================
// Stockr – P2P Sync screen
// Uses MultipeerConnectivity to discover a nearby iPhone and exchange
// all warehouse/box/item data. Works without internet via Bluetooth/WiFi.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/src/lib/supabase';
import { exportSyncBundle, importSyncBundle } from '@/src/lib/p2pSync';
import {
  startSession,
  stopSession,
  invitePeer,
  sendData,
  onPeerFound,
  onPeerLost,
  onConnecting,
  onConnected,
  onDisconnected,
  onDataReceived,
  onError,
} from '@/modules/stockr-multipeer/src';
import { colors, radius, spacing, typography } from '@/src/theme';
import { Icon } from '@/src/components/Icon';

type Phase = 'idle' | 'searching' | 'connecting' | 'connected' | 'syncing' | 'done' | 'error';

interface Peer {
  displayName: string;
}

export default function P2PSyncScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connectedPeer, setConnectedPeer] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ inserted: number; updated: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  // Get user ID on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      userIdRef.current = data.session?.user.id ?? null;
    });
  }, []);

  // Start discovery
  const handleStart = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const displayName = data.session?.user.email ?? 'Stockr User';
      userIdRef.current = data.session?.user.id ?? null;

      await startSession(displayName);
      setPhase('searching');
      setPeers([]);
      setConnectedPeer(null);
      setSyncResult(null);
      setErrorMsg(null);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Failed to start');
      setPhase('error');
    }
  }, []);

  // Subscribe to native events
  useEffect(() => {
    const subs = [
      onPeerFound((e) => {
        setPeers((prev) => {
          if (prev.some((p) => p.displayName === e.peerDisplayName)) return prev;
          return [...prev, { displayName: e.peerDisplayName }];
        });
      }),
      onPeerLost((e) => {
        setPeers((prev) => prev.filter((p) => p.displayName !== e.peerDisplayName));
      }),
      onConnecting((e) => {
        setPhase('connecting');
        setConnectedPeer(e.peerDisplayName);
      }),
      onConnected((e) => {
        setPhase('connected');
        setConnectedPeer(e.peerDisplayName);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }),
      onDisconnected(() => {
        if (phase !== 'done') {
          setPhase('searching');
          setConnectedPeer(null);
        }
      }),
      onDataReceived((e) => {
        // Received sync bundle from the other device — merge it
        try {
          const result = importSyncBundle(e.data);
          setSyncResult({ inserted: result.inserted, updated: result.updated });
          setPhase('done');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch (err: any) {
          setErrorMsg(err?.message ?? 'Import failed');
          setPhase('error');
        }
      }),
      onError((e) => {
        setErrorMsg(e.message);
        setPhase('error');
      }),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [phase]);

  // Connect to a discovered peer
  const handleConnect = useCallback(async (peer: Peer) => {
    try {
      await invitePeer(peer.displayName);
      setPhase('connecting');
      setConnectedPeer(peer.displayName);
    } catch (e: any) {
      Alert.alert('Connection failed', e?.message ?? 'Unknown error');
    }
  }, []);

  // Send local data to connected peer
  const handleSync = useCallback(async () => {
    if (!userIdRef.current) return;
    try {
      setPhase('syncing');
      const bundle = exportSyncBundle(userIdRef.current);
      await sendData(bundle);
      // After sending, we stay in 'syncing' until we receive the other side's data.
      // If both devices tap Sync at roughly the same time, both exchange bundles.
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Send failed');
      setPhase('error');
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopSession().catch(() => {});
    };
  }, []);

  const handleDone = () => {
    stopSession().catch(() => {});
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          hitSlop={12}
          onPress={() => { stopSession().catch(() => {}); router.back(); }}
          style={({ pressed }) => [styles.topBarBtn, pressed && { opacity: 0.5 }]}
        >
          <Icon sf="chevron.left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>P2P Sync</Text>
        <View style={styles.topBarBtn} />
      </View>

      <View style={styles.content}>
        {/* IDLE */}
        {phase === 'idle' && (
          <View style={styles.center}>
            <Icon sf="antenna.radiowaves.left.and.right" size={64} color={colors.primary} />
            <Text style={styles.headline}>Sync with nearby iPhone</Text>
            <Text style={styles.description}>
              Uses Bluetooth and WiFi to exchange data directly with another Stockr device. No
              internet needed.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
              onPress={handleStart}
            >
              <Icon sf="magnifyingglass" size={18} color={colors.textOnPrimary} />
              <Text style={styles.primaryBtnText}>Start searching</Text>
            </Pressable>
          </View>
        )}

        {/* SEARCHING */}
        {phase === 'searching' && (
          <View style={styles.searchSection}>
            <View style={styles.searchingHeader}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.searchingText}>Searching for nearby devices...</Text>
            </View>
            <Text style={styles.hint}>
              Make sure the other device also has Stockr open on this screen.
            </Text>

            {peers.length > 0 && (
              <View style={styles.peerList}>
                <Text style={styles.sectionLabel}>DEVICES FOUND</Text>
                {peers.map((peer) => (
                  <Pressable
                    key={peer.displayName}
                    style={({ pressed }) => [styles.peerRow, pressed && { opacity: 0.7 }]}
                    onPress={() => handleConnect(peer)}
                  >
                    <Icon sf="iphone" size={24} color={colors.primary} />
                    <View style={styles.peerInfo}>
                      <Text style={styles.peerName}>{peer.displayName}</Text>
                      <Text style={styles.peerHint}>Tap to connect</Text>
                    </View>
                    <Icon sf="arrow.right.circle.fill" size={24} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {/* CONNECTING */}
        {phase === 'connecting' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.headline}>Connecting...</Text>
            <Text style={styles.description}>Establishing secure connection with {connectedPeer}</Text>
          </View>
        )}

        {/* CONNECTED */}
        {phase === 'connected' && (
          <View style={styles.center}>
            <Icon sf="checkmark.circle.fill" size={64} color={colors.success} />
            <Text style={styles.headline}>Connected</Text>
            <Text style={styles.description}>Connected to {connectedPeer}. Tap sync to exchange data.</Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
              onPress={handleSync}
            >
              <Icon sf="arrow.triangle.2.circlepath" size={18} color={colors.textOnPrimary} />
              <Text style={styles.primaryBtnText}>Sync now</Text>
            </Pressable>
          </View>
        )}

        {/* SYNCING */}
        {phase === 'syncing' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.headline}>Syncing...</Text>
            <Text style={styles.description}>Exchanging data with {connectedPeer}. Keep both devices nearby.</Text>
          </View>
        )}

        {/* DONE */}
        {phase === 'done' && (
          <View style={styles.center}>
            <Icon sf="checkmark.circle.fill" size={64} color={colors.success} />
            <Text style={styles.headline}>Sync complete</Text>
            {syncResult && (
              <Text style={styles.description}>
                {syncResult.inserted} new items added, {syncResult.updated} items updated.
              </Text>
            )}
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
              onPress={handleDone}
            >
              <Text style={styles.primaryBtnText}>Done</Text>
            </Pressable>
          </View>
        )}

        {/* ERROR */}
        {phase === 'error' && (
          <View style={styles.center}>
            <Icon sf="exclamationmark.triangle.fill" size={64} color={colors.warningText} />
            <Text style={styles.headline}>Something went wrong</Text>
            <Text style={styles.description}>{errorMsg}</Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
              onPress={handleStart}
            >
              <Text style={styles.primaryBtnText}>Try again</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { ...typography.headline, color: colors.text, flex: 1, textAlign: 'center' },

  content: { flex: 1, paddingHorizontal: spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, paddingBottom: 80 },

  headline: { ...typography.title2, color: colors.text, textAlign: 'center' },
  description: { ...typography.subhead, color: colors.textMuted, textAlign: 'center', maxWidth: 300 },
  hint: { ...typography.footnote, color: colors.textSubtle, textAlign: 'center', marginTop: spacing.sm },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.full,
    marginTop: spacing.md,
  },
  primaryBtnText: { ...typography.bodyStrong, color: colors.textOnPrimary },

  // Searching
  searchSection: { flex: 1, paddingTop: spacing.xl },
  searchingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  searchingText: { ...typography.body, color: colors.text },

  // Peer list
  peerList: { marginTop: spacing.xl, gap: spacing.sm },
  sectionLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  peerInfo: { flex: 1, gap: 2 },
  peerName: { ...typography.headline, color: colors.text },
  peerHint: { ...typography.footnote, color: colors.textMuted },
});
