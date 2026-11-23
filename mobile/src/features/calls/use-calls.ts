import { useSyncExternalStore } from 'react';
import { calls } from '../../application/services';

export const useCalls = () => useSyncExternalStore(calls.subscribe, calls.getSnapshot);
