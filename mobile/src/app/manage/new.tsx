import { PropertyEditorScreen } from '../../features/management/PropertyEditorScreen';
import { useSession } from '../../application/use-session';
import { canManage } from '../../features/management/form';
export default function NewPropertyRoute() {
  const state = useSession();
  return state.status === 'signedIn' && canManage(state.user.role) ? (
    <PropertyEditorScreen key={state.user.id} actor={state.user.id} />
  ) : null;
}
