import { useCallback } from 'react';
import { calls, callsApi } from '../../application/services';
import { NativeMedia } from '../media/NativeMedia';
import { Call } from './api';
import { DirectCallMedia } from './DirectCallMedia';
import { ActivityIndicator } from 'react-native';

export function NativeCall({ call }: { call: Call }) {
  const token = useCallback(() => callsApi.token(call.id), [call.id]);
  return (
    <NativeMedia
      id={call.id}
      kind={call.kind}
      loadToken={token}
      failed={calls.mediaFailed}
      connecting={
        <ActivityIndicator accessibilityLabel="Connecting call" color="#D9E8E0" size="large" />
      }
      names={{
        [call.caller.id]: call.caller.display_name,
        [call.callee.id]: call.callee.display_name,
      }}
    >
      <DirectCallMedia video={call.kind === 'video'} />
    </NativeMedia>
  );
}
