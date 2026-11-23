import { useCallback } from 'react';
import { calls, callsApi } from '../../application/services';
import { NativeMedia } from '../media/NativeMedia';
import { Call } from './api';
import { CallMedia } from './CallMedia';
import { ActivityIndicator } from 'react-native';
import { VideoCallConnecting, VideoCallOptions } from './VideoCallFrame';

export function NativeCall({
  call,
  videoOptions,
}: {
  call: Call;
  videoOptions?: VideoCallOptions;
}) {
  const token = useCallback(() => callsApi.token(call.id), [call.id]);
  return (
    <NativeMedia
      id={call.id}
      kind={call.kind}
      loadToken={token}
      failed={calls.mediaFailed}
      connecting={
        videoOptions ? (
          <VideoCallConnecting options={videoOptions} />
        ) : (
          <ActivityIndicator accessibilityLabel="Connecting call" color="#D9E8E0" size="large" />
        )
      }
      names={{
        [call.caller.id]: call.caller.display_name,
        [call.callee.id]: call.callee.display_name,
      }}
    >
      <CallMedia
        names={{
          [call.caller.id]: call.caller.display_name,
          [call.callee.id]: call.callee.display_name,
        }}
        videoOptions={videoOptions}
      />
    </NativeMedia>
  );
}
