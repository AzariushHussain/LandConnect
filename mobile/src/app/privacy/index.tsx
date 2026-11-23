import { useSession } from '../../application/use-session';
import { PrivacyScreen } from '../../features/privacy/PrivacyScreen';
export default function PrivacyRoute() {
  const state = useSession();
  return state.status === 'signedIn' ? <PrivacyScreen key={state.user.id} /> : null;
}
