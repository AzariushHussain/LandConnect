import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { groupCalls, meetingSession, session } from '../../application/services';
import { ChatAvatar } from '../chat/ChatAvatar';
import { IconButton } from '../../ui/IconButton';
import { useMeeting } from '../meetings/use-meetings';

export function GroupCallBanner() {
  const state = useMeeting(),
    path = usePathname();
  const action = useSyncExternalStore(groupCalls.subscribe, groupCalls.getSnapshot);
  const call =
    state.meeting?.conversation_id && state.joined ? state.meeting : state.incomingGroupCall;
  if (!call || call.ended_at || !state.foreground || path === `/group-calls/${call.id}`)
    return null;
  const incoming = !state.joined || state.id !== call.id;
  async function decline() {
    await meetingSession.select(call!.id);
    if (meetingSession.getSnapshot().id === call!.id) await meetingSession.change('decline');
  }
  return (
    <View style={styles.banner}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open group call ${call.title}`}
        onPress={() => router.navigate({ pathname: '/group-calls/[id]', params: { id: call.id } })}
        style={styles.summary}
      >
        <ChatAvatar name={call.title} group dark size={42} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={1} style={styles.name}>
            {call.title}
          </Text>
          <Text style={styles.detail}>
            {incoming
              ? `${call.owner.display_name} · Group ${call.kind} call`
              : 'Return to group call'}
          </Text>
        </View>
      </Pressable>
      {incoming && call.owner.id !== session.access()?.user.id && (
        <View style={styles.actions}>
          <IconButton
            icon="call"
            label="Decline incoming group call"
            tone="danger"
            busy={action.busy || state.busy || state.joining}
            onPress={() => void decline()}
          />
          <IconButton
            icon={call.kind === 'video' ? 'videocam' : 'call'}
            label="Answer incoming group call"
            tone="success"
            busy={action.busy || state.busy || state.joining}
            onPress={() => {
              void groupCalls.answer(call.id);
              router.navigate({ pathname: '/group-calls/[id]', params: { id: call.id } });
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
  actions: { flexDirection: 'row', gap: 8 },
  name: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  detail: { color: '#BDDBCB', fontSize: 13 },
});
