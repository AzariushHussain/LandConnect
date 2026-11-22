import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'LandConnect',
  slug: 'landconnect',
  scheme: 'landconnect',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  experiments: { typedRoutes: true },
  android: { package: 'com.landconnect.app', predictiveBackGestureEnabled: true },
  ios: { bundleIdentifier: 'com.landconnect.app', supportsTablet: true },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    './plugins/with-cmake-paths',
    // Android's generated debug manifest permits Metro/LAN HTTP; release stays HTTPS-only.
    ['expo-build-properties', { android: { usesCleartextTraffic: false } }],
  ],
};

export default config;
