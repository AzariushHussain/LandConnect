import { useEffect } from 'react';
import { ActivityIndicator, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DefaultTheme, Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { realtime, session } from '../application/services';
import { useSession } from '../application/use-session';
import { Action, Brand, Notice, Screen } from '../ui/components';
import { colors } from '../ui/theme';
import { canManage } from '../features/management/form';

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
  useEffect(() => {
    if (state.status !== 'signedIn') {
      realtime.stop();
      return;
    }
    const update = () => {
      if (AppState.currentState === 'active') realtime.start();
      else realtime.stop();
    };
    update();
    const listener = AppState.addEventListener('change', update);
    return () => {
      listener.remove();
      realtime.stop();
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
              <Stack.Screen name="index" options={{ title: 'LandConnect' }} />
              <Stack.Screen name="account" options={{ title: 'My account' }} />
              <Stack.Screen name="listings/[id]" options={{ title: 'Property details' }} />
              <Stack.Screen name="map" options={{ title: 'Property map' }} />
              <Stack.Screen name="chats/index" options={{ title: 'Chats' }} />
              <Stack.Screen name="chats/new-group" options={{ title: 'New group' }} />
              <Stack.Screen name="chats/[id]/index" options={{ title: 'Conversation' }} />
              <Stack.Screen name="chats/[id]/info" options={{ title: 'Group information' }} />
              <Stack.Protected guard={state.status === 'signedIn' && canManage(state.user.role)}>
                <Stack.Screen name="manage/index" options={{ title: 'My properties' }} />
                <Stack.Screen name="manage/new" options={{ title: 'Add property' }} />
                <Stack.Screen name="manage/[id]" options={{ title: 'Manage property' }} />
              </Stack.Protected>
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
