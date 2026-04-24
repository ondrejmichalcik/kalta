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

      let sess = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
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
      guard let targetPeer = self.delegate?.discoveredPeers.first(where: { $0.displayName == peerDisplayName }) else {
        throw MultipeerError.peerNotFound
      }
      browser.invitePeer(targetPeer, to: session, withContext: nil, timeout: 30)
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
    discoveredPeers.append(peerID)
    DispatchQueue.main.async {
      self.module?.sendEvent("onPeerFound", [
        "peerDisplayName": peerID.displayName
      ])
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    discoveredPeers.removeAll { $0 == peerID }
    DispatchQueue.main.async {
      self.module?.sendEvent("onPeerLost", [
        "peerDisplayName": peerID.displayName
      ])
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
    DispatchQueue.main.async {
      self.module?.sendEvent("onError", ["message": error.localizedDescription])
    }
  }
}
