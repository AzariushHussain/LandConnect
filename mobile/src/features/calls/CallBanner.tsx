import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { session } from '../../application/services';
import { colors } from '../../ui/theme';
import { active } from './api';
import { useCalls } from './use-calls';

export function CallBanner() {
  const state = useCalls(),
    path = usePathname();
  const call = state.call;
  if (path === '/calls' || !state.foreground || (!active(call) && !state.attempt)) return null;
  const incoming = call?.callee.id === session.access()?.user.id;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open call controls"
      onPress={() => router.navigate('/calls')}
      style={styles.banner}
    >
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {call
          ? `${incoming && call.status === 'ringing' ? 'Incoming' : 'Current'} ${call.kind} call - ${incoming ? call.caller.display_name : call.callee.display_name}`
          : 'Unconfirmed outgoing call'}
      </Text>
      <Text style={styles.text}>Tap for call controls</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  banner: { padding: 18, backgroundColor: colors.green, gap: 5 },
  text: { color: 'white', fontWeight: '600' },
});
