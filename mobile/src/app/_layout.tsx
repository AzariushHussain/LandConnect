import { useEffect } from 'react';
import { ActivityIndicator, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DefaultTheme, Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { session } from '../application/services';
import { useSession } from '../application/use-session';
import { Action, Brand, Notice, Screen } from '../ui/components';
import { colors } from '../ui/theme';

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.green,
    background: colors.background,
    card: colors.background,
    text: colors.ink,
    border: colors.border,
  },
};

export default function RootLayout() {
  const state = useSession();
  useEffect(() => {
    void session.restore();
  }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') session.checkExpiry();
    });
    if (state.status !== 'signedIn') return () => listener.remove();
    const timer = setTimeout(session.checkExpiry, Math.max(0, state.expiresAt - Date.now()));
    return () => {
      listener.remove();
      clearTimeout(timer);
    };
  }, [state]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {state.status === 'loading' ? (
        <Screen>
          <Brand />
          <ActivityIndicator
            accessibilityLabel="Restoring your session"
            color={colors.green}
            size="large"
          />
        </Screen>
      ) : state.status === 'restoreError' || state.status === 'storageError' ? (
        <Screen>
          <Brand />
          <Notice error>{state.message}</Notice>
          {state.status === 'restoreError' && (
            <Action label="Retry connection" onPress={() => void session.restore()} />
          )}
          <Action
            label={
              state.status === 'storageError' ? 'Retry erasing session' : 'Sign out of this device'
            }
            secondary
            onPress={() => void session.signOut()}
          />
        </Screen>
      ) : (
        <ThemeProvider value={theme}>
          <Stack screenOptions={{ headerShadowVisible: false, headerTintColor: colors.ink }}>
            <Stack.Protected guard={state.status === 'signedIn'}>
              <Stack.Screen name="index" options={{ title: 'My account' }} />
            </Stack.Protected>
            <Stack.Protected guard={state.status === 'signedOut'}>
              <Stack.Screen name="sign-in" options={{ title: 'Welcome' }} />
              <Stack.Screen name="register" options={{ title: 'Join LandConnect' }} />
            </Stack.Protected>
          </Stack>
        </ThemeProvider>
      )}
    </SafeAreaProvider>
  );
}
