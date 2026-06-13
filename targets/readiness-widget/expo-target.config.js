/**
 * @bacons/apple-targets — Readiness home-screen widget target.
 * Shares data with the app via the App Group below (must be enabled on the
 * App ID in Apple Developer; the app writes via ExtensionStorage in
 * src/lib/widget.ts and the Swift widget reads the same UserDefaults suite).
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'widget',
  name: 'KaltaReadiness',
  deploymentTarget: '17.0',
  entitlements: {
    'com.apple.security.application-groups': ['group.com.ondrejmichalcik.kalta'],
  },
};
