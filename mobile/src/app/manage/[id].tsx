import { useLocalSearchParams } from 'expo-router';
import { PropertyEditorScreen } from '../../features/management/PropertyEditorScreen';
export default function ManagePropertyRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <PropertyEditorScreen key={String(id)} id={typeof id === 'string' && id ? id : 'invalid'} />
  );
}
