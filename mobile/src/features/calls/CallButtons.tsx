import { router } from 'expo-router';
import { calls, session } from '../../application/services';
import { Action } from '../../ui/components';
import { IconButton } from '../../ui/IconButton';
import { View } from 'react-native';
import { active } from './api';
import { useCalls } from './use-calls';

export function CallButtons({ peerId, compact = false }: { peerId: string; compact?: boolean }) {
  const state = useCalls();
  if (peerId === session.access()?.user.id) return null;
  if (active(state.call) || state.attempt)
    return compact ? (
      <IconButton
        icon="call"
        label="Return to current call"
        onPress={() => router.navigate('/calls')}
      />
    ) : (
      <Action label="Open current call" secondary onPress={() => router.navigate('/calls')} />
    );
  if (compact)
    return (
      <View style={{ flexDirection: 'row' }}>
        <IconButton
          icon="call-outline"
          label="Audio call"
          disabled={state.busy || !state.foreground}
          onPress={() => {
            void calls.start(peerId, 'audio');
            router.navigate('/calls');
          }}
        />
        <IconButton
          icon="videocam-outline"
          label="Video call"
          disabled={state.busy || !state.foreground}
          onPress={() => {
            void calls.start(peerId, 'video');
            router.navigate('/calls');
          }}
        />
      </View>
    );
  return (
    <>
      <Action
        label="Audio call"
        secondary
        disabled={state.busy || !state.foreground}
        onPress={() => {
          void calls.start(peerId, 'audio');
          router.navigate('/calls');
        }}
      />
      <Action
        label="Video call"
        secondary
        disabled={state.busy || !state.foreground}
        onPress={() => {
          void calls.start(peerId, 'video');
          router.navigate('/calls');
        }}
      />
    </>
  );
}
