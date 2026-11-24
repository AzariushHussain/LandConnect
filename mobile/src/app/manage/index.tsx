import { useSession } from '../../application/use-session';
import { canManage } from '../../features/management/form';
import { MyPropertiesScreen } from '../../features/management/MyPropertiesScreen';

export default function MyPropertiesRoute() {
  const state = useSession();
  return state.status === 'signedIn' && canManage(state.user.role) ? (
    <MyPropertiesScreen key={state.user.id} actor={state.user.id} />
  ) : null;
}
