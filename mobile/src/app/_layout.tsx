import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { registerGlobals, setLogLevel } from '@livekit/react-native';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DefaultTheme, Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { calls, groupCalls, meetingSession, realtime, session } from '../application/services';
import { useSession } from '../application/use-session';
import { Action, Brand, Notice, Screen } from '../ui/components';
import { colors } from '../ui/theme';
import { canManage } from '../features/management/form';
import { CallBanner } from '../features/calls/CallBanner';
import { MeetingBanner } from '../features/meetings/MeetingBanner';
import { GroupCallBanner } from '../features/calls/GroupCallBanner';

registerGlobals();
setLogLevel('silent');

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
  const realtimeToken = state.status === 'signedIn' ? session.access()?.token : null;
  useEffect(() => {
    void session.restore();
  }, []);
  useEffect(() => {
    groupCalls.reset();
    return groupCalls.reset;
  }, [realtimeToken]);
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
    if (!realtimeToken) {
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
  }, [realtimeToken]);

  useEffect(() => {
    if (!realtimeToken) {
      meetingSession.reset();
      return;
    }
    const update = () => {
      if (AppState.currentState === 'active') meetingSession.foreground(true);
      else if (AppState.currentState === 'background') meetingSession.foreground(false);
    };
    update();
    const app = AppState.addEventListener('change', update);
    const unsubscribe = realtime.onMeetingHint(meetingSession.hint);
    const refresh = setInterval(() => {
      const current = meetingSession.getSnapshot().meeting;
      if (current && (!current.ended_at || current.media_cleanup_pending))
        void meetingSession.refresh();
    }, 5000);
    const discover = setInterval(() => void meetingSession.discover(), 15000);
    return () => {
      app.remove();
      unsubscribe();
      clearInterval(refresh);
      clearInterval(discover);
      meetingSession.reset();
    };
  }, [realtimeToken]);
  useEffect(() => {
    if (!realtimeToken) {
      calls.reset();
      return;
    }
    const update = () => {
      if (AppState.currentState === 'active') calls.foreground(true);
      else if (AppState.currentState === 'background') calls.foreground(false);
    };
    update();
    const listener = AppState.addEventListener('change', update);
    const unsubscribe = realtime.onCallHint((hint) => {
      if (hint.type === 'reconcile') calls.hint();
      else calls.hint(hint.call_id, !['call.incoming', 'call.accepted'].includes(hint.type));
    });
    const timer = setInterval(() => void calls.refresh(), 5000);
    return () => {
      listener.remove();
      unsubscribe();
      clearInterval(timer);
      calls.reset();
    };
  }, [realtimeToken]);

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
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShadowVisible: false, headerTintColor: colors.ink }}>
              <Stack.Protected guard={state.status === 'signedIn'}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="calls" options={{ headerShown: false }} />
                <Stack.Screen name="group-calls/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="meetings/index" options={{ title: 'Meetings' }} />
                <Stack.Screen name="meetings/new" options={{ title: 'Host a meeting' }} />
                <Stack.Screen name="meetings/[id]" options={{ title: 'Meeting controls' }} />
                <Stack.Screen name="privacy/index" options={{ title: 'Privacy settings' }} />
                <Stack.Screen name="privacy/blocked" options={{ title: 'Blocked accounts' }} />
                <Stack.Screen name="listings/[id]" options={{ title: 'Property details' }} />
                <Stack.Screen name="property-map/[id]" options={{ title: 'Property location' }} />
                <Stack.Screen name="chats/new-group" options={{ title: 'New group' }} />
                <Stack.Screen name="chats/[id]/index" options={{ headerShown: false }} />
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
            {state.status === 'signedIn' && <CallBanner />}
            {state.status === 'signedIn' && <GroupCallBanner />}
            {state.status === 'signedIn' && <MeetingBanner />}
          </View>
        </ThemeProvider>
      )}
    </SafeAreaProvider>
  );
}
