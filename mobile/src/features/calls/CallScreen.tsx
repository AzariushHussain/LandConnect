import { Alert, Linking } from 'react-native';
import { useEffect, useState } from 'react';
import { usePreventRemove } from 'expo-router';
import { calls, session } from '../../application/services';
import { Action, Heading, Notice, Screen } from '../../ui/components';
import { RealtimeNotice } from '../chat/use-chat-updates';
import { active } from './api';
import { useCalls } from './use-calls';
import { NativeCall } from './NativeCall';

export function CallScreen() {
  const state = useCalls();
  const call = state.call;
  const [leave, setLeave] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (leave) leave();
  }, [leave]);
  usePreventRemove(!leave && (active(call) || state.busy), ({ repeat }) => {
    if (state.busy) {
      Alert.alert(
        'Confirm this call first',
        'Wait for the current request to finish before leaving.',
      );
      return;
    }
    Alert.alert('Leave the call?', 'This stops media and ends or declines the current call.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'End and leave',
        style: 'destructive',
        onPress: () => {
          void calls.finish().then(() => {
            if (!active(calls.getSnapshot().call)) setLeave(() => repeat);
          });
        },
      },
    ]);
  });
  const incoming = call?.callee.id === session.access()?.user.id;
  return (
    <Screen>
      <Heading
        title={call ? `${call.kind === 'video' ? 'Video' : 'Audio'} call` : 'Calls'}
        detail={
          call
            ? `${incoming ? call.caller.display_name : call.callee.display_name} - ${call.status}`
            : 'Call a property owner or someone in a direct chat.'
        }
      />
      <Notice>
        Keep LandConnect open during calls. Moving it to the background stops media and attempts to
        finish the call.
      </Notice>
      <RealtimeNotice />
      {!!state.error && <Notice error>{state.error}</Notice>}
      {state.attempt && (
        <>
          <Notice>
            An outgoing request is unconfirmed. Retrying uses the same call identifier.
          </Notice>
          <Action
            label="Retry same outgoing call"
            busy={state.busy}
            onPress={() => void calls.retry()}
          />
        </>
      )}
      {call?.status === 'ringing' && (
        <>
          <Notice>
            {incoming
              ? 'Incoming call. Accept to let the caller know you are ready, then join media.'
              : 'Waiting for an answer.'}{' '}
            Ringing expires at {new Date(call.expires_at).toLocaleTimeString()}.
          </Notice>
          {incoming && (
            <Action
              label="Accept call"
              busy={state.busy}
              disabled={!state.foreground || !state.verified}
              onPress={() => void calls.accept()}
            />
          )}
          <Action
            label={incoming ? 'Decline call' : 'Cancel call'}
            secondary
            busy={state.busy}
            onPress={() => void calls.finish()}
          />
        </>
      )}
      {call?.status === 'accepted' && (
        <>
          {state.joined && state.verified && state.foreground ? (
            <NativeCall key={call.id} call={call} />
          ) : (
            <>
              <Notice>
                Join media to request your microphone{call.kind === 'video' ? ' and camera' : ''}.
                Media permissions are requested only when you join.
              </Notice>
              <Action
                label="Join call media"
                busy={state.busy}
                disabled={!state.foreground}
                onPress={() => void calls.join()}
              />
              <Action
                label="Open app permission settings"
                secondary
                onPress={() => {
                  void Linking.openSettings().catch(() =>
                    Alert.alert(
                      'Settings unavailable',
                      'Open LandConnect permissions in your device settings.',
                    ),
                  );
                }}
              />
            </>
          )}
          <Action label="End call" busy={state.busy} onPress={() => void calls.finish()} />
        </>
      )}
      {!!call?.media_cleanup_pending && (
        <Notice>
          The call has finished. The server is still closing its media room; cleanup will retry
          automatically.
        </Notice>
      )}
      <Action
        label="Refresh call status"
        secondary
        disabled={state.busy || !state.foreground}
        onPress={() => void calls.refresh()}
      />
    </Screen>
  );
}
