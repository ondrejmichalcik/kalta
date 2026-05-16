import ExpoModulesCore
import MultipeerConnectivity

// ============================================================================
// Kalta – MultipeerConnectivity Expo Module
// Enables iPhone-to-iPhone P2P sync without internet via Bluetooth/WiFi.
//
// Flow:
// 1. Both devices call startSession() — advertises + browses simultaneously
// 2. onPeerFound fires with peer info
// 3. User taps connect → invitePeer(peerId)
// 4. Other device auto-accepts (same serviceType = trusted)
// 5. onConnected fires on both
// 6. sendData(jsonString) → onDataReceived on the other side
// 7. stopSession() when done
// ============================================================================

private let serviceType = "kalta-sync" // max 15 chars, lowercase + hyphens

public class KaltaMultipeerModule: Module {
  fileprivate var peerID: MCPeerID?
  fileprivate var session: MCSession?
  fileprivate var advertiser: MCNearbyServiceAdvertiser?
  fileprivate var browser: MCNearbyServiceBrowser?
  fileprivate var delegate: SessionDelegate?

  public func definition() -> ModuleDefinition {
    Name("KaltaMultipeer")

    Events(
      "onPeerFound",
      "onPeerLost",
      "onConnecting",
      "onConnected",
      "onDisconnected",
      "onDataReceived",
      "onError"
    )

    // Start advertising + browsing. `displayName` is shown to other devices.
    AsyncFunction("startSession") { (displayName: String) in
      // MCPeerID throws NSInternalInconsistencyException (uncatchable in
      // Swift) if displayName is empty or > 63 bytes UTF-8. Sanitize here
      // so we fail with a proper JS error instead of crashing the app.
      let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else {
        throw MultipeerError.invalidDisplayName("Display name is empty.")
      }
      // Truncate to 63 bytes UTF-8. Apple's hard cap.
      var safe = trimmed
      while safe.utf8.count > 63, !safe.isEmpty {
        safe.removeLast()
      }

      self.cleanup()

      let peer = MCPeerID(displayName: safe)
      self.peerID = peer

      // `.none` rather than `.required`: the encryption handshake on
      // `.required` is the single biggest reliability problem with
      // MCSession on iOS — many users see 6–10 failed connect attempts
      // before one sticks. Both peers here are trusted (same Bonjour
      // service type, same signed app), traffic goes over Bluetooth /
      // AWDL on a transient nearby link rather than the public WiFi
      // segment, and our family-scale data is non-sensitive enough that
      // unencrypted Bluetooth is fine for the use case.
      let sess = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .none)
      let del = SessionDelegate(module: self)
      sess.delegate = del
      self.session = sess
      self.delegate = del

      let adv = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: nil, serviceType: serviceType)
      adv.delegate = del
      self.advertiser = adv
      adv.startAdvertisingPeer()

      let brow = MCNearbyServiceBrowser(peer: peer, serviceType: serviceType)
      brow.delegate = del
      self.browser = brow
      brow.startBrowsingForPeers()
    }

    // Invite a discovered peer to connect.
    AsyncFunction("invitePeer") { (peerDisplayName: String) in
      guard let browser = self.browser, let session = self.session else {
        throw MultipeerError.notStarted
      }
      // Take the LAST match by displayName — Bonjour rediscovery can
      // leave older MCPeerIDs in the list for a beat, and inviting the
      // stale one fails silently. The dedupe in `foundPeer` already
      // prunes most of these, but `last` is a defensive belt-and-braces.
      guard let targetPeer = self.delegate?.discoveredPeers.last(where: { $0.displayName == peerDisplayName }) else {
        throw MultipeerError.peerNotFound
      }
      // Tighter invitation timeout (10s instead of 30s) — if the peer
      // doesn't come through quickly, the JS-side watchdog will reset
      // the session and let the user retry. 30s of indeterminate wait
      // was a meaningful chunk of the "6–10 attempts" UX problem.
      browser.invitePeer(targetPeer, to: session, withContext: nil, timeout: 10)
    }

    // Send a string (JSON sync bundle) to all connected peers.
    AsyncFunction("sendData") { (jsonString: String) in
      guard let session = self.session else {
        throw MultipeerError.notStarted
      }
      guard !session.connectedPeers.isEmpty else {
        throw MultipeerError.noPeersConnected
      }
      guard let data = jsonString.data(using: .utf8) else {
        throw MultipeerError.encodingFailed
      }

      // For large payloads, use reliable transport.
      try session.send(data, toPeers: session.connectedPeers, with: .reliable)
    }

    // Get list of currently connected peers.
    Function("getConnectedPeers") { () -> [[String: String]] in
      guard let session = self.session else { return [] }
      return session.connectedPeers.map { ["displayName": $0.displayName] }
    }

    // Recreate the MCSession instance while keeping the existing
    // MCPeerID, advertiser, and browser alive. Used when an invite
    // appears to have been silently dropped by Apple's stack — recycling
    // just the session lets us retry the invite without forcing the
    // peer to rediscover us under a fresh MCPeerID (which is the slow
    // path that wastes 5–15s of Bonjour time).
    AsyncFunction("refreshSession") {
      self.refreshSessionAfterDisconnect()
    }

    // Stop everything and clean up.
    AsyncFunction("stopSession") {
      self.cleanup()
    }
  }

  fileprivate func cleanup() {
    advertiser?.stopAdvertisingPeer()
    browser?.stopBrowsingForPeers()
    session?.disconnect()
    advertiser = nil
    browser = nil
    session = nil
    delegate = nil
    peerID = nil
  }

  // Recover from a wedged MCSession after a `.notConnected` event by
  // building a brand-new session bound to the same delegate. Keeps
  // advertiser/browser alive so peer discovery doesn't restart from
  // scratch — only the connection-state machine resets.
  fileprivate func refreshSessionAfterDisconnect() {
    guard let peer = self.peerID, let del = self.delegate else { return }
    self.session?.disconnect()
    let fresh = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .none)
    fresh.delegate = del
    self.session = fresh
  }

  deinit {
    cleanup()
  }
}

// MARK: - Errors

enum MultipeerError: Error, CustomStringConvertible {
  case notStarted
  case peerNotFound
  case noPeersConnected
  case encodingFailed
  case invalidDisplayName(String)

  var description: String {
    switch self {
    case .notStarted: return "Session not started. Call startSession() first."
    case .peerNotFound: return "Peer not found in discovered list."
    case .noPeersConnected: return "No peers connected."
    case .encodingFailed: return "Failed to encode data."
    case .invalidDisplayName(let msg): return "Invalid display name: \(msg)"
    }
  }
}

// MARK: - Session + Advertiser + Browser delegate

private class SessionDelegate: NSObject, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
  weak var module: KaltaMultipeerModule?
  var discoveredPeers: [MCPeerID] = []

  init(module: KaltaMultipeerModule) {
    self.module = module
  }

  // -- MCSessionDelegate --

  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    DispatchQueue.main.async {
      switch state {
      case .connecting:
        self.module?.sendEvent("onConnecting", [
          "peerDisplayName": peerID.displayName
        ])
      case .connected:
        self.module?.sendEvent("onConnected", [
          "peerDisplayName": peerID.displayName
        ])
      case .notConnected:
        // After a failed connect, MCSession can wedge into a state
        // where future invitePeer calls silently no-op. Replace the
        // session with a fresh instance and rebind it to the existing
        // advertiser so incoming invitations still work. Browser is
        // unaffected — peer discovery keeps running.
        self.module?.refreshSessionAfterDisconnect()
        self.module?.sendEvent("onDisconnected", [
          "peerDisplayName": peerID.displayName
        ])
      @unknown default:
        break
      }
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    guard let jsonString = String(data: data, encoding: .utf8) else { return }
    DispatchQueue.main.async {
      self.module?.sendEvent("onDataReceived", [
        "peerDisplayName": peerID.displayName,
        "data": jsonString
      ])
    }
  }

  // Unused but required by protocol
  func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
  func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
  func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}

  // -- MCNearbyServiceAdvertiserDelegate --

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
    // Auto-accept invitations from Kalta peers (same serviceType = trusted family device).
    if let session = module?.session {
      invitationHandler(true, session)
    } else {
      invitationHandler(false, nil)
    }
  }

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
    DispatchQueue.main.async {
      self.module?.sendEvent("onError", ["message": error.localizedDescription])
    }
  }

  // -- MCNearbyServiceBrowserDelegate --

  func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
    // Drop any prior entries with the same displayName — a peer can be
    // re-discovered with a fresh MCPeerID after a transient drop, and
    // inviting the stale one fails silently.
    discoveredPeers.removeAll { $0.displayName == peerID.displayName }
    discoveredPeers.append(peerID)
    DispatchQueue.main.async {
      self.module?.sendEvent("onPeerFound", [
        "peerDisplayName": peerID.displayName
      ])
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    discoveredPeers.removeAll { $0 == peerID }
    // Suppress the JS event when the same peer is still around under a
    // different MCPeerID — Bonjour can drop+rediscover the same device
    // with a fresh ID, and our `foundPeer` dedupe just replaced the
    // entry. If we emitted onPeerLost here the JS-side peer list would
    // briefly hide a peer that is in fact still invitable, leading to
    // a flaky "tap a name that disappears under your finger" UX.
    let stillReachable = discoveredPeers.contains { $0.displayName == peerID.displayName }
    DispatchQueue.main.async {
      if !stillReachable {
        self.module?.sendEvent("onPeerLost", [
          "peerDisplayName": peerID.displayName
        ])
      }
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
    DispatchQueue.main.async {
      self.module?.sendEvent("onError", ["message": error.localizedDescription])
    }
  }
}
