import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { calls, session } from '../../application/services';
import { IconButton } from '../../ui/IconButton';
import { ChatAvatar } from '../chat/ChatAvatar';
import { active } from './api';
import { useCalls } from './use-calls';

export function CallBanner() {
  const state = useCalls(),
    path = usePathname(),
    call = state.call;
  if (path === '/calls' || !state.foreground || (!active(call) && !state.attempt)) return null;
  const incoming = call?.callee.id === session.access()?.user.id;
  const name = call ? (incoming ? call.caller.display_name : call.callee.display_name) : 'Calling…';
  return (
    <View style={styles.banner}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open call with ${name}`}
        onPress={() => router.navigate('/calls')}
        style={styles.summary}
      >
        <ChatAvatar name={name} size={42} dark />
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text style={styles.detail}>
            {incoming && call?.status === 'ringing'
              ? `Incoming ${call.kind} call`
              : 'Return to call'}
          </Text>
        </View>
      </Pressable>
      {incoming && call?.status === 'ringing' && (
        <View style={styles.buttons}>
          <IconButton
            icon="call"
            label="Decline incoming call"
            tone="danger"
            busy={state.busy}
            onPress={() => void calls.finish()}
          />
          <IconButton
            icon="call"
            label="Answer incoming call"
            tone="success"
            busy={state.busy}
            disabled={!state.verified}
            onPress={() => {
              void calls.accept();
              router.navigate('/calls');
            }}
          />
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    backgroundColor: '#173A2E',
  },
  summary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  buttons: { flexDirection: 'row', gap: 10 },
  name: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  detail: { color: '#BDDBCB', fontSize: 13 },
});
