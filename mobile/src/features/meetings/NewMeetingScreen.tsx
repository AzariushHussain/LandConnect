import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { router, usePreventRemove } from 'expo-router';
import { chatApi, meetingsApi } from '../../application/services';
import { Action, Field, Heading, Notice, Screen } from '../../ui/components';
import { CallKind } from '../calls/api';
import { Person } from '../chat/types';
import { PeoplePicker } from '../chat/PeoplePicker';
import { MeetingCreation } from './creation';

export function NewMeetingScreen({ actor, group }: { actor: string; group?: string }) {
  const [creation] = useState(() => new MeetingCreation(meetingsApi, randomUUID));
  const state = useSyncExternalStore(creation.subscribe, creation.getSnapshot);
  const [title, setTitle] = useState(''),
    [kind, setKind] = useState<CallKind>('video');
  const [selected, setSelected] = useState<Person[]>([]),
    [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(!!group),
    [groupError, setGroupError] = useState('');
  const [discard, setDiscard] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!group) return;
    let alive = true;
    chatApi
      .detail(group)
      .then(
        (chat) => {
          if (!alive) return;
          if (chat.kind !== 'group') {
            setGroupError('Choose people manually; this is not a group.');
            return;
          }
          setTitle(chat.name ?? 'Group meeting');
          setSelected(chat.members.filter((m) => m.user.id !== actor).map((m) => m.user));
        },
        () => {
          if (alive)
            setGroupError(
              'Group could not be loaded. Choose people manually from your current conversations.',
            );
        },
      )
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [group, actor]);
  const disable = usePreventRemove(
    !discard && (state.busy || !!title || selected.length > 0 || !!state.attempt),
    ({ repeat }) => {
      if (state.busy) {
        Alert.alert('Please wait', 'Wait for meeting creation to finish.');
        return;
      }
      Alert.alert(
        'Leave meeting creation?',
        state.attempt
          ? 'Creation is unconfirmed. Check Meetings before creating again; this retry identifier will be lost.'
          : 'Your unsaved title and selections will be lost.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => {
              setDiscard(true);
              repeat();
            },
          },
        ],
      );
    },
  );
  async function create() {
    const meeting = await creation.submit(
      title,
      kind,
      selected.map((p) => p.id),
    );
    if (meeting && mounted.current) {
      setDiscard(true);
      disable();
      router.replace({ pathname: '/meetings/[id]', params: { id: meeting.id } });
    }
  }
  const locked = loading || state.busy || !!state.attempt;
  return (
    <Screen>
      <Heading
        title="Host a meeting"
        detail="Invite 1 to 49 people. You become the host; everyone else must accept before joining media."
      />
      <Notice>
        Group members are a starting selection. Meeting access is separate from chat membership and
        is managed here after creation.
      </Notice>
      {!!groupError && <Notice error>{groupError}</Notice>}
      <Field
        label="Meeting title"
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        maxLength={150}
      />
      <Action
        label={`Meeting type: ${kind}. Switch to ${kind === 'video' ? 'audio' : 'video'}`}
        secondary
        disabled={locked}
        onPress={() => setKind(kind === 'video' ? 'audio' : 'video')}
      />
      <Action
        label="Choose invited people"
        secondary
        disabled={locked}
        onPress={() => setChoosing(true)}
      />
      {selected.map((p) => (
        <Notice key={p.id}>
          {p.display_name} - {p.role}
        </Notice>
      ))}
      {choosing && (
        <PeoplePicker
          actor={actor}
          selected={selected}
          max={49}
          onCancel={() => setChoosing(false)}
          onDone={(people) => {
            setSelected(people);
            setChoosing(false);
          }}
        />
      )}
      {!!state.error && <Notice error>{state.error}</Notice>}
      {!!state.attempt && !state.busy && (
        <Notice>
          Details are frozen for this unconfirmed request. Retrying keeps the same identifier and
          invitation list.
        </Notice>
      )}
      <Action
        label={
          state.attempt ? 'Retry same meeting creation' : 'Create meeting and send invitations'
        }
        busy={state.busy}
        disabled={loading || !selected.length || !title.trim()}
        onPress={() => void create()}
      />
    </Screen>
  );
}
