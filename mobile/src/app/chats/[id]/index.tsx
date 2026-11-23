import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../../application/use-session';
import { ThreadScreen } from '../../../features/chat/ThreadScreen';
import { uuid } from '../../../features/chat/types';
import { Notice, Screen } from '../../../ui/components';
export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useSession();
  if (state.status !== 'signedIn') return null;
  if (typeof id !== 'string' || !uuid(id))
    return (
      <Screen>
        <Notice error>Invalid conversation link.</Notice>
      </Screen>
    );
  return <ThreadScreen key={`${state.user.id}:${id}`} actor={state.user.id} id={id} />;
}
