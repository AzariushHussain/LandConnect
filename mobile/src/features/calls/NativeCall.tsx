import { useCallback } from 'react';
import { calls, callsApi } from '../../application/services';
import { NativeMedia } from '../media/NativeMedia';
import { Call } from './api';

export function NativeCall({ call }: { call: Call }) {
  const token = useCallback(() => callsApi.token(call.id), [call.id]);
  return (
    <NativeMedia
      id={call.id}
      kind={call.kind}
      loadToken={token}
      failed={calls.mediaFailed}
      names={{
        [call.caller.id]: call.caller.display_name,
        [call.callee.id]: call.callee.display_name,
      }}
    />
  );
}
