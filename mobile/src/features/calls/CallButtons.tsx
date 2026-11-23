import { router } from 'expo-router';
import { calls, session } from '../../application/services';
import { Action } from '../../ui/components';
import { active } from './api';
import { useCalls } from './use-calls';

export function CallButtons({ peerId }: { peerId: string }) {
  const state = useCalls();
  if (peerId === session.access()?.user.id) return null;
  if (active(state.call) || state.attempt)
    return <Action label="Open current call" secondary onPress={() => router.navigate('/calls')} />;
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
