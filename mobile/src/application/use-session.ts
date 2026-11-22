import { useSyncExternalStore } from 'react';
import { session } from './services';

export const useSession = () => useSyncExternalStore(session.subscribe, session.getSnapshot);
