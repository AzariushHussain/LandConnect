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
    '@maplibre/maplibre-react-native',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Find nearby properties or help choose a property location when you request it.',
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    '@livekit/react-native-expo-plugin',
    [
      '@config-plugins/react-native-webrtc',
      {
        cameraPermission: 'Use your camera during a LandConnect video call you join.',
        microphonePermission: 'Use your microphone during a LandConnect call you join.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Choose photos to add to your property listing.',
        cameraPermission: 'Use your camera during a LandConnect video call you join.',
        microphonePermission: 'Use your microphone during a LandConnect call you join.',
      },
    ],
    './plugins/with-cmake-paths',
    // Android's generated debug manifest permits Metro/LAN HTTP; release stays HTTPS-only.
    ['expo-build-properties', { android: { usesCleartextTraffic: false } }],
  ],
};

export default config;
