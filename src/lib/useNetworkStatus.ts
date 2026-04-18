// ============================================================================
// Stockr – Network connectivity hook
// Returns current online/offline status via expo-network.
// Also triggers a sync cycle when the device comes back online.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

/**
 * Polls network state on mount + on app foreground. Returns `true` when
 * the device has internet connectivity, `false` otherwise.
 *
 * `onReconnect` fires exactly once per offline → online transition so the
 * caller can kick off a sync cycle.
 */
export function useNetworkStatus(onReconnect?: () => void): boolean {
  const [isConnected, setIsConnected] = useState(true);
  const wasOffline = useRef(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        const online = !!(state.isConnected && state.isInternetReachable);
        if (!mounted) return;

        if (wasOffline.current && online) {
          onReconnect?.();
        }
        wasOffline.current = !online;
        setIsConnected(online);
      } catch {
        // expo-network not available (e.g. Expo Go on web) — assume online
      }
    };

    // Check on mount
    check();

    // Re-check when app comes to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });

    // Poll every 15 seconds for more responsive offline detection
    const interval = setInterval(check, 15_000);

    return () => {
      mounted = false;
      sub.remove();
      clearInterval(interval);
    };
  }, [onReconnect]);

  return isConnected;
}
