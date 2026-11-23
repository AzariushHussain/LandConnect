import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, usePreventRemove } from 'expo-router';
import { chatApi } from '../../application/services';
import { Action, Field, Heading, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { Conversation, permissions } from './types';
import { PeoplePicker } from './PeoplePicker';
import { useChatUpdates } from './use-chat-updates';
import { ChatHint } from './realtime';
import { ApiError } from '../../api/client';

export function GroupInfoScreen({ id, actor }: { id: string; actor: string }) {
  const [chat, setChat] = useState<Conversation | null>(null),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [inviting, setInviting] = useState(false);
  const locked = useRef(false),
    mounted = useRef(true),
    generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disablePrevention = usePreventRemove(busy, () =>
    Alert.alert('Please wait', 'Wait for this group change to finish.'),
  );
  // Screen focus owns the private snapshot; a membership failure removes it immediately.
  const refresh = useCallback(() => {
    if (locked.current) return;
    const request = ++generation.current;
    chatApi.detail(id).then(
      (value) => {
        if (mounted.current && generation.current === request) {
          setChat(value);
          setError('');
        }
      },
      (failure: unknown) => {
        if (mounted.current && generation.current === request) {
          setChat(null);
          setError(
            failure instanceof Error ? failure.message : 'Group information is unavailable.',
          );
        }
      },
    );
  }, [id]);
  const onHint = useCallback(
    (event: ChatHint) => {
      if (
        event.type === 'membership.removed' &&
        event.conversation_id === id &&
        event.target_user_id === actor
      ) {
        generation.current++;
        setChat(null);
        setInviting(false);
        setError('You no longer have access to this group.');
      }
    },
    [id, actor],
  );
  useChatUpdates(refresh, onHint);
  async function run(action: () => Promise<Conversation | void>) {
    if (locked.current) return;
    locked.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (result && mounted.current && generation.current === request) setChat(result);
    } catch (failure) {
      if (mounted.current && generation.current === request) {
        if (failure instanceof ApiError && (failure.status === 404 || failure.status === 401))
          setChat(null);
        setError(
          `${failure instanceof Error ? failure.message : 'Could not confirm the change.'} Refresh group information before repeating it.`,
        );
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function confirm(label: string, action: () => Promise<Conversation | void>) {
    if (locked.current) return;
    Alert.alert(
      label,
      'This updates group access immediately. Refresh the group if the result cannot be confirmed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void run(action) },
      ],
    );
  }
  const access = chat ? permissions(chat, actor) : null;
  return (
    <Screen>
      <Heading
        title={chat?.name ?? 'Group information'}
        detail="Only current members can view group history. New members can read retained history. Group permissions are separate from marketplace roles."
      />
      {!!error && <Notice error>{error}</Notice>}
      <Action label="Refresh group information" secondary disabled={busy} onPress={refresh} />
      {chat?.kind === 'group' && access && (
        <>
          <Notice>{chat.members.length} of 50 members</Notice>
          {access.admin && (
            <>
              <Field
                label="New group name"
                value={name}
                editable={!busy}
                onChangeText={setName}
                maxLength={100}
              />
              <Action
                label="Rename group"
                secondary
                disabled={busy || !name.trim()}
                onPress={() => confirm('Rename group?', () => chatApi.rename(id, name))}
              />
              <Action
                label="Add a member"
                secondary
                disabled={busy || chat.members.length >= 50}
                onPress={() => setInviting(true)}
              />
            </>
          )}
          {inviting && (
            <PeoplePicker
              actor={actor}
              excluded={chat.members.map((member) => member.user.id)}
              max={1}
              selected={[]}
              onCancel={() => setInviting(false)}
              onDone={(people) => {
                setInviting(false);
                if (people[0])
                  confirm(`Add ${people[0].display_name}?`, () =>
                    chatApi.invite(id, people[0]!.id),
                  );
              }}
            />
          )}
          {chat.members.map((member) => (
            <View key={member.user.id} style={styles.member}>
              <Text style={styles.name}>
                {member.user.display_name}
                {member.user.id === actor ? ' (you)' : ''}
              </Text>
              <Notice>
                {member.user.role} · {member.user.id === chat.owner_id ? 'Owner' : member.role}
              </Notice>
              {access.owner && member.user.id !== actor && (
                <>
                  <Action
                    label={member.role === 'admin' ? 'Make member' : 'Make admin'}
                    secondary
                    disabled={busy}
                    onPress={() =>
                      confirm('Change group role?', () =>
                        chatApi.role(
                          id,
                          member.user.id,
                          member.role === 'admin' ? 'member' : 'admin',
                        ),
                      )
                    }
                  />
                  <Action
                    label="Transfer ownership"
                    secondary
                    disabled={busy}
                    onPress={() =>
                      confirm(`Make ${member.user.display_name} the owner?`, () =>
                        chatApi.transfer(id, member.user.id),
                      )
                    }
                  />
                </>
              )}
              {access.canRemove(member.user.id) && (
                <Action
                  label={`Remove ${member.user.display_name}`}
                  secondary
                  disabled={busy}
                  onPress={() =>
                    confirm('Remove group member?', async () => {
                      await chatApi.remove(id, member.user.id);
                      return chatApi.detail(id);
                    })
                  }
                />
              )}
            </View>
          ))}
          {access.canLeave ? (
            <Action
              label="Leave group"
              secondary
              disabled={busy}
              onPress={() =>
                confirm('Leave this group?', async () => {
                  await chatApi.remove(id);
                  if (!mounted.current) return;
                  setChat(null);
                  setBusy(false);
                  disablePrevention();
                  router.replace('/chats');
                })
              }
            />
          ) : (
            <Notice>Transfer ownership to another member before leaving.</Notice>
          )}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  member: {
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    gap: 10,
  },
  name: { fontSize: 18, color: colors.ink, fontWeight: '700' },
});
