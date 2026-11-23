import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../../application/use-session';
import { GroupInfoScreen } from '../../../features/chat/GroupInfoScreen';
import { uuid } from '../../../features/chat/types';
import { Notice, Screen } from '../../../ui/components';
export default function GroupRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useSession();
  if (state.status !== 'signedIn') return null;
  if (typeof id !== 'string' || !uuid(id))
    return (
      <Screen>
        <Notice error>Invalid group link.</Notice>
      </Screen>
    );
  return <GroupInfoScreen key={`${state.user.id}:${id}`} actor={state.user.id} id={id} />;
}
