import { useCallback, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { meetingSession, realtime } from '../../application/services';

export const useMeeting = () =>
  useSyncExternalStore(meetingSession.subscribe, meetingSession.getSnapshot);
export function useMeetingUpdates(refresh: () => unknown) {
  useFocusEffect(
    useCallback(() => {
      const run = () => {
        if (AppState.currentState === 'active') refresh();
      };
      run();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = realtime.onMeetingHint(() => {
        clearTimeout(timer);
        timer = setTimeout(run, 200);
      });
      const interval = setInterval(run, 15000);
      const app = AppState.addEventListener('change', (state) => {
        if (state === 'active') run();
      });
      return () => {
        unsubscribe();
        app.remove();
        clearTimeout(timer);
        clearInterval(interval);
      };
    }, [refresh]),
  );
}
