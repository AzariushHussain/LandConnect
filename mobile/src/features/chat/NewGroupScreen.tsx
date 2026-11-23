import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { router, usePreventRemove } from 'expo-router';
import { chatApi } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Field, Heading, Notice, Screen } from '../../ui/components';
import { PeoplePicker } from './PeoplePicker';
import { Person } from './types';

export function NewGroupScreen() {
  const session = useSession();
  const [name, setName] = useState(''),
    [selected, setSelected] = useState<Person[]>([]),
    [choosing, setChoosing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disable = usePreventRemove(
    !discard && (busy || !!name || selected.length > 0),
    ({ repeat }) => {
      if (locked.current) return;
      Alert.alert(
        'Leave group creation?',
        'Unsaved selections will be lost. If creation was not confirmed, check Chats before creating again.',
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
  if (session.status !== 'signedIn') return null;
  async function create() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const chat = await chatApi.group(
        name,
        selected.map((person) => person.id),
      );
      if (!mounted.current) return;
      setDiscard(true);
      disable();
      router.replace({ pathname: '/chats/[id]', params: { id: chat.id } });
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not create this group. Refresh Chats before retrying.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen>
      <Heading
        title="Create a group"
        detail="Choose 1 to 49 other people. You become the owner; group history is shared with all current members, including people added later."
      />
      <Field
        label="Group name"
        value={name}
        onChangeText={setName}
        editable={!busy}
        maxLength={100}
      />
      <Action
        label="Choose group members"
        secondary
        disabled={busy}
        onPress={() => setChoosing(true)}
      />
      {selected.map((person) => (
        <Notice key={person.id}>
          {person.display_name} · {person.role}
        </Notice>
      ))}
      {choosing && (
        <PeoplePicker
          actor={session.user.id}
          max={49}
          selected={selected}
          onCancel={() => setChoosing(false)}
          onDone={(people) => {
            setSelected(people);
            setChoosing(false);
          }}
        />
      )}
      {!!error && <Notice error>{error}</Notice>}
      <Action
        label="Create group"
        busy={busy}
        disabled={!selected.length}
        onPress={() => void create()}
      />
    </Screen>
  );
}
