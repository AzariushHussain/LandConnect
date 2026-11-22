import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { locateOnce } from './locate';

export function useDeviceLocation(
  onLocation: (point: Awaited<ReturnType<typeof locateOnce>>) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    const current = generation;
    return () => {
      current.current++;
    };
  }, []);
  const ignorePending = () => {
    generation.current++;
  };
  async function locate() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const current = ++generation.current;
    try {
      const point = await locateOnce({
        requestPermission: Location.requestForegroundPermissionsAsync,
        servicesEnabled: Location.hasServicesEnabledAsync,
        position: () =>
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            mayShowUserSettingsDialog: false,
          }),
      });
      if (generation.current === current && AppState.currentState === 'active') onLocation(point);
    } catch (failure) {
      if (generation.current === current)
        setError(failure instanceof Error ? failure.message : 'Could not read device location.');
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  }
  // Ignore a late GPS result after a manual selection. The bounded request itself is one-shot.
  function cancel() {
    ignorePending();
    setBusy(false);
    setError('');
  }
  return { busy, error, locate, cancel };
}
