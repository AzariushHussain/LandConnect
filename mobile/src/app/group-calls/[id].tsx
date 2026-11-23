import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../application/use-session';
import { GroupCallScreen } from '../../features/calls/GroupCallScreen';
import { uuid } from '../../features/chat/types';
import { Notice, Screen } from '../../ui/components';
export default function GroupCallRoute() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    state = useSession();
  if (state.status !== 'signedIn') return null;
  if (typeof id !== 'string' || !uuid(id))
    return (
      <Screen>
        <Notice error>Invalid group call link.</Notice>
      </Screen>
    );
  return <GroupCallScreen key={`${state.user.id}:${id}`} actor={state.user.id} id={id} />;
}
