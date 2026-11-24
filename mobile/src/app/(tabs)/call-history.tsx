import { useSession } from '../../application/use-session';
import { CallHistoryScreen } from '../../features/calls/CallHistoryScreen';

export default function HistoryRoute() {
  const state = useSession();
  return state.status === 'signedIn' ? (
    <CallHistoryScreen key={state.user.id} actor={state.user.id} />
  ) : null;
}
