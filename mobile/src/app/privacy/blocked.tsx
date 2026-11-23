import { useSession } from '../../application/use-session';
import { BlockedAccountsScreen } from '../../features/privacy/BlockedAccountsScreen';
export default function BlocksRoute() {
  const state = useSession();
  return state.status === 'signedIn' ? <BlockedAccountsScreen key={state.user.id} /> : null;
}
