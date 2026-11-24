import { NewGroupScreen } from '../../features/chat/NewGroupScreen';
import { useSession } from '../../application/use-session';

export default function NewGroupRoute() {
  const state = useSession();
  return state.status === 'signedIn' ? <NewGroupScreen key={state.user.id} /> : null;
}
