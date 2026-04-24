Pod::Spec.new do |s|
  s.name           = 'KaltaMultipeer'
  s.version        = '1.0.0'
  s.summary        = 'MultipeerConnectivity module for Kalta P2P sync'
  s.description    = 'Enables iPhone-to-iPhone data sync via Bluetooth/WiFi without internet'
  s.homepage       = 'https://github.com/ondrejmichalcik/kalta'
  s.license        = 'MIT'
  s.author         = 'Ondrej Michalcik'
  s.platform       = :ios, '16.0'
  s.source         = { git: '' }
  s.source_files   = '*.swift'
  s.frameworks     = 'MultipeerConnectivity'

  s.dependency 'ExpoModulesCore'
end
