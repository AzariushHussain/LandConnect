import { useLocalSearchParams } from 'expo-router';
import { PropertyEditorScreen } from '../../features/management/PropertyEditorScreen';
import { useSession } from '../../application/use-session';
import { canManage } from '../../features/management/form';
export default function ManagePropertyRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useSession();
  if (state.status !== 'signedIn' || !canManage(state.user.role)) return null;
  return (
    <PropertyEditorScreen
      key={`${state.user.id}:${String(id)}`}
      actor={state.user.id}
      id={typeof id === 'string' && id ? id : 'invalid'}
    />
  );
}
