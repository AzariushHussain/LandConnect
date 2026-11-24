import { router } from 'expo-router';
import { calls, session } from '../../application/services';
import { Action } from '../../ui/components';
import { IconButton } from '../../ui/IconButton';
import { View } from 'react-native';
import { active } from './api';
import { useCalls } from './use-calls';

export function CallButtons({
  peerId,
  compact = false,
  disabled = false,
  onOpen,
}: {
  peerId: string;
  compact?: boolean;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  const state = useCalls();
  function open() {
    onOpen?.();
    router.navigate('/calls');
  }
  if (peerId === session.access()?.user.id) return null;
  if (active(state.call) || state.attempt)
    return compact ? (
      <IconButton icon="call" label="Return to current call" disabled={disabled} onPress={open} />
    ) : (
      <Action label="Open current call" secondary disabled={disabled} onPress={open} />
    );
  if (compact)
    return (
      <View style={{ flexDirection: 'row' }}>
        <IconButton
          icon="call-outline"
          label="Audio call"
          disabled={disabled || state.busy || !state.foreground}
          onPress={() => {
            void calls.start(peerId, 'audio');
            open();
          }}
        />
        <IconButton
          icon="videocam-outline"
          label="Video call"
          disabled={disabled || state.busy || !state.foreground}
          onPress={() => {
            void calls.start(peerId, 'video');
            open();
          }}
        />
      </View>
    );
  return (
    <>
      <Action
        label="Audio call"
        secondary
        disabled={disabled || state.busy || !state.foreground}
        onPress={() => {
          void calls.start(peerId, 'audio');
          open();
        }}
      />
      <Action
        label="Video call"
        secondary
        disabled={disabled || state.busy || !state.foreground}
        onPress={() => {
          void calls.start(peerId, 'video');
          open();
        }}
      />
    </>
  );
}
