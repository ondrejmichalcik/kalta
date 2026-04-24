// ============================================================================
// Kalta – MultipeerConnectivity JS API
// Wraps the native KaltaMultipeer module for P2P sync between iPhones.
// ============================================================================
import { requireNativeModule } from 'expo-modules-core';

// New-style Expo modules are themselves event emitters — they expose
// addListener / removeListeners directly. `LegacyEventEmitter` is an
// compatibility wrapper for the old bridge protocol; on an Expo Modules
// v2 module it just returns the module back, so using the module as
// the emitter is equivalent AND avoids the Hermes-Legacy code path
// that was implicated in a segfault on P2P screen mount.
const KaltaMultipeer = requireNativeModule('KaltaMultipeer');
const emitter: {
  addListener: (event: string, fn: (e: any) => void) => { remove(): void };
} = KaltaMultipeer as any;

// ---- Core API ---------------------------------------------------------------

export function startSession(displayName: string): Promise<void> {
  return KaltaMultipeer.startSession(displayName);
}

export function invitePeer(peerDisplayName: string): Promise<void> {
  return KaltaMultipeer.invitePeer(peerDisplayName);
}

export function sendData(jsonString: string): Promise<void> {
  return KaltaMultipeer.sendData(jsonString);
}

export function getConnectedPeers(): { displayName: string }[] {
  return KaltaMultipeer.getConnectedPeers();
}

export function stopSession(): Promise<void> {
  return KaltaMultipeer.stopSession();
}

// ---- Events -----------------------------------------------------------------

export interface PeerEvent {
  peerDisplayName: string;
}

export interface DataReceivedEvent {
  peerDisplayName: string;
  data: string;
}

export interface ErrorEvent {
  message: string;
}

export function onPeerFound(fn: (event: PeerEvent) => void) {
  return emitter.addListener('onPeerFound', fn);
}

export function onPeerLost(fn: (event: PeerEvent) => void) {
  return emitter.addListener('onPeerLost', fn);
}

export function onConnecting(fn: (event: PeerEvent) => void) {
  return emitter.addListener('onConnecting', fn);
}

export function onConnected(fn: (event: PeerEvent) => void) {
  return emitter.addListener('onConnected', fn);
}

export function onDisconnected(fn: (event: PeerEvent) => void) {
  return emitter.addListener('onDisconnected', fn);
}

export function onDataReceived(fn: (event: DataReceivedEvent) => void) {
  return emitter.addListener('onDataReceived', fn);
}

export function onError(fn: (event: ErrorEvent) => void) {
  return emitter.addListener('onError', fn);
}
