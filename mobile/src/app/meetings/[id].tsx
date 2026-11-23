import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../application/use-session';
import { MeetingScreen } from '../../features/meetings/MeetingScreen';
import { uuid } from '../../features/chat/types';
import { Notice, Screen } from '../../ui/components';
export default function MeetingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    state = useSession();
  if (state.status !== 'signedIn') return null;
  if (typeof id !== 'string' || !uuid(id))
    return (
      <Screen>
        <Notice error>Invalid meeting link.</Notice>
      </Screen>
    );
  return <MeetingScreen key={`${state.user.id}:${id}`} actor={state.user.id} id={id} />;
}
