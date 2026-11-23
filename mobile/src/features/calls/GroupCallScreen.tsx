import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useIsFocused, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { groupCalls, meetingSession, meetingsApi } from '../../application/services';
import { ChatAvatar } from '../chat/ChatAvatar';
import { IconButton } from '../../ui/IconButton';
import { NativeMedia } from '../media/NativeMedia';
import { currentMembers, memberStatus, Meeting } from '../meetings/api';
import { useMeeting } from '../meetings/use-meetings';
import { CallMedia } from './CallMedia';
import { VideoCallConnecting, VideoCallOptions } from './VideoCallFrame';

const back = () => (router.canGoBack() ? router.back() : router.replace('/chats'));
function GroupMedia({ call, videoOptions }: { call: Meeting; videoOptions?: VideoCallOptions }) {
  const token = useCallback(
    () => meetingsApi.token(call.id, call.room_version),
    [call.id, call.room_version],
  );
  const names = Object.fromEntries(
    currentMembers(call).map((m) => [m.user.id, m.user.display_name]),
  );
  return (
    <NativeMedia
      id={`${call.id}:${call.room_version}`}
      kind={call.kind}
      loadToken={token}
      failed={meetingSession.mediaFailed}
      names={names}
      connecting={
        videoOptions ? (
          <VideoCallConnecting options={videoOptions} group />
        ) : (
          <ActivityIndicator accessibilityLabel="Connecting group call" color="#FFFFFF" />
        )
      }
    >
      <CallMedia group names={names} videoOptions={videoOptions} />
    </NativeMedia>
  );
}
export function GroupCallScreen({ id, actor }: { id: string; actor: string }) {
  const state = useMeeting(),
    focused = useIsFocused();
  const action = useSyncExternalStore(groupCalls.subscribe, groupCalls.getSnapshot);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  useFocusEffect(
    useCallback(() => {
      void meetingSession.select(id);
    }, [id]),
  );
  useEffect(() => () => meetingSession.detach(id), [id]);
  useEffect(() => {
    if (leave) leave();
  }, [leave]);
  const call = state.id === id ? state.meeting : null;
  const owner = call?.owner.id === actor;
  const invited = !!call && memberStatus(call, actor) === 'invited';
  const open = !!call?.conversation_id && !call.ended_at;
  const busy = action.busy || state.busy || state.joining;
  async function finish(navigate = back) {
    if (!call) {
      setLeave(() => navigate);
      return;
    }
    const saved = await meetingSession.change(owner ? 'end' : invited ? 'decline' : 'leave');
    if (saved) setLeave(() => navigate);
  }
  usePreventRemove(!leave && open && (busy || state.joined), ({ repeat }) => {
    if (busy) {
      Alert.alert('Please wait', 'Wait for the call request to finish.');
      return;
    }
    Alert.alert(
      'Leave group call?',
      owner ? 'This ends the call for everyone.' : 'Your media will disconnect.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave call', style: 'destructive', onPress: () => void finish(repeat) },
      ],
    );
  });
  if (
    call?.conversation_id &&
    call.kind === 'video' &&
    focused &&
    state.joined &&
    state.verified &&
    state.foreground
  )
    return (
      <View style={{ flex: 1, backgroundColor: '#0B141A' }}>
        <GroupMedia
          key={`${call.id}:${call.room_version}`}
          call={call}
          videoOptions={{
            title: call.title,
            onBack: back,
            onEnd: () => void finish(),
            endBusy: busy,
            endLabel: owner ? 'End group call for everyone' : 'Leave group call',
            endCaption: owner ? 'End' : 'Leave',
          }}
        />
      </View>
    );
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <IconButton icon="chevron-back" label="Back from group call" tone="dark" onPress={back} />
        <Text style={styles.caption}>LandConnect group {call?.kind ?? ''} call</Text>
        <View style={{ width: 46 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <ChatAvatar name={call?.title ?? 'Group call'} group size={100} dark />
        <Text style={styles.name}>{call?.title ?? 'Group call'}</Text>
        {(state.loading || busy) && (
          <ActivityIndicator color="#FFFFFF" accessibilityLabel="Preparing group call" />
        )}
        {call?.ended_at && <Text style={styles.caption}>Call ended</Text>}
        {open && (
          <Text style={styles.caption}>
            {invited ? `${call.owner.display_name} is calling` : 'Group call'} ·{' '}
            {currentMembers(call!).length} invited participants
          </Text>
        )}
        {!!(action.error || state.error) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {(action.error || state.error).replace(/meeting/gi, 'group call')}
          </Text>
        )}
        {call?.conversation_id && focused && state.joined && state.verified && state.foreground && (
          <GroupMedia key={`${call.id}:${call.room_version}`} call={call} />
        )}
        {open && !invited && !state.joined && !busy && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void groupCalls.answer(id)}
            style={styles.retry}
          >
            <Text style={styles.link}>Reconnect call</Text>
          </Pressable>
        )}
        {!call && !state.loading && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void meetingSession.select(id)}
            style={styles.retry}
          >
            <Text style={styles.link}>Refresh call</Text>
          </Pressable>
        )}
        {!open && !busy && (
          <Pressable accessibilityRole="button" onPress={back} style={styles.retry}>
            <Text style={styles.link}>Done</Text>
          </Pressable>
        )}
      </ScrollView>
      {open && (
        <View style={styles.bottom}>
          <IconButton
            icon="call"
            label={
              invited
                ? 'Decline group call'
                : owner
                  ? 'End group call for everyone'
                  : 'Leave group call'
            }
            caption={invited ? 'Decline' : owner ? 'End call' : 'Leave'}
            tone="danger"
            size={68}
            busy={busy}
            onPress={() => void finish()}
          />
          {invited && (
            <IconButton
              icon={call?.kind === 'video' ? 'videocam' : 'call'}
              label="Answer group call"
              caption="Answer"
              tone="success"
              size={68}
              busy={busy}
              disabled={!state.verified || !state.foreground}
              onPress={() => void groupCalls.answer(id)}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B211B' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 22 },
  name: { color: '#FFFFFF', fontSize: 28, fontWeight: '600', textAlign: 'center' },
  caption: { color: '#BDDBCB', textAlign: 'center', fontSize: 14 },
  error: { color: '#F7B9BE', textAlign: 'center' },
  bottom: { flexDirection: 'row', justifyContent: 'space-evenly', padding: 24 },
  retry: { padding: 14, borderRadius: 24, backgroundColor: '#234A3B' },
  link: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
