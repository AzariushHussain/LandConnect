import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../application/use-session';
import { NewMeetingScreen } from '../../features/meetings/NewMeetingScreen';
import { uuid } from '../../features/chat/types';
import { Notice, Screen } from '../../ui/components';
export default function NewMeetingRoute() {
  const { group } = useLocalSearchParams<{ group?: string }>(),
    state = useSession();
  if (state.status !== 'signedIn') return null;
  if (group !== undefined && (typeof group !== 'string' || !uuid(group)))
    return (
      <Screen>
        <Notice error>Invalid group link.</Notice>
      </Screen>
    );
  return (
    <NewMeetingScreen
      key={`${state.user.id}:${group ?? 'new'}`}
      actor={state.user.id}
      group={group}
    />
  );
}
