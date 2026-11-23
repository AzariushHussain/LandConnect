import { useCallback, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { realtime } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import type { ChatHint } from './realtime';

export function useChatUpdates(refresh: () => unknown, onHint?: (hint: ChatHint) => void) {
  useFocusEffect(
    useCallback(() => {
      const run = () => {
        if (AppState.currentState === 'active') refresh();
      };
      run();
      let debounce: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = realtime.onHint((hint) => {
        onHint?.(hint);
        clearTimeout(debounce);
        debounce = setTimeout(run, 200);
      });
      const timer = setInterval(run, 15000);
      const app = AppState.addEventListener('change', (state) => {
        if (state === 'active') run();
      });
      return () => {
        unsubscribe();
        app.remove();
        clearInterval(timer);
        clearTimeout(debounce);
      };
    }, [refresh, onHint]),
  );
}
export function RealtimeNotice() {
  const state = useSyncExternalStore(realtime.subscribe, realtime.getSnapshot);
  return (
    <>
      <Notice>
        {state.status === 'ready'
          ? 'Live updates connected.'
          : 'Live updates are reconnecting or paused. History can still be refreshed.'}
      </Notice>
      {state.status === 'paused' && (
        <Action label="Reconnect live updates" secondary onPress={realtime.reconnect} />
      )}
    </>
  );
}
