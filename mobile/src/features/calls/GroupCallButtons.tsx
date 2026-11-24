import { useCallback, useRef, useSyncExternalStore } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { groupCalls } from '../../application/services';
import { IconButton } from '../../ui/IconButton';
import { useMeeting } from '../meetings/use-meetings';
import { CallKind } from './api';

export function GroupCallButtons({
  conversationId,
  expanded = false,
}: {
  conversationId: string;
  expanded?: boolean;
}) {
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        groupCalls.cancelStart();
      };
    }, []),
  );
  const state = useSyncExternalStore(groupCalls.subscribe, groupCalls.getSnapshot);
  const media = useMeeting();
  const current = media.meeting?.conversation_id === conversationId && media.joined;
  async function start(kind: CallKind) {
    const call = await groupCalls.start(conversationId, kind);
    if (!focused.current) return;
    if (call) router.navigate({ pathname: '/group-calls/[id]', params: { id: call.id } });
    else if (groupCalls.getSnapshot().error)
      Alert.alert('Group call', groupCalls.getSnapshot().error.replace(/meeting/gi, 'group call'));
  }
  if (current && media.id)
    return (
      <IconButton
        icon="call"
        label="Return to group call"
        caption={expanded ? 'Return' : undefined}
        tone={expanded ? 'soft' : 'plain'}
        size={expanded ? 52 : 46}
        onPress={() =>
          router.navigate({ pathname: '/group-calls/[id]', params: { id: media.id! } })
        }
      />
    );
  return (
    <View style={{ flexDirection: 'row', gap: expanded ? 26 : 0 }}>
      <IconButton
        icon="call-outline"
        label="Group audio call"
        caption={expanded ? 'Audio' : undefined}
        tone={expanded ? 'soft' : 'plain'}
        size={expanded ? 52 : 46}
        busy={state.busy}
        disabled={!media.foreground}
        onPress={() => void start('audio')}
      />
      <IconButton
        icon="videocam-outline"
        label="Group video call"
        caption={expanded ? 'Video' : undefined}
        tone={expanded ? 'soft' : 'plain'}
        size={expanded ? 52 : 46}
        busy={state.busy}
        disabled={!media.foreground}
        onPress={() => void start('video')}
      />
    </View>
  );
}
