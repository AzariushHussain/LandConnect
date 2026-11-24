import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePreventRemove } from 'expo-router';
import { chatApi } from '../../application/services';
import { Action, Field, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { IconButton } from '../../ui/IconButton';
import { Conversation, permissions } from './types';
import { PeoplePicker } from './PeoplePicker';
import { useChatUpdates } from './use-chat-updates';
import { ChatHint } from './realtime';
import { ApiError } from '../../api/client';
import { ChatAvatar } from './ChatAvatar';
import { GroupCallButtons } from '../calls/GroupCallButtons';
import { CallButtons } from '../calls/CallButtons';
import { GroupActionRow, GroupActionSheet } from './GroupActions';
import { participantActions } from './participant-actions';

export function GroupInfoScreen({ id, actor }: { id: string; actor: string }) {
  const [chat, setChat] = useState<Conversation | null>(null),
    [name, setName] = useState(''),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [inviting, setInviting] = useState(false),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
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
  const refresh = useCallback(() => {
    if (locked.current) return;
    const request = ++generation.current;
    setLoading(true);
    chatApi.detail(id).then(
      (value) => {
        if (mounted.current && generation.current === request) {
          setChat(value);
          setError('');
          setLoading(false);
        }
      },
      (failure: unknown) => {
        if (mounted.current && generation.current === request) {
          setChat(null);
          setLoading(false);
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
        setEditing(false);
        setSelected(null);
        setLoading(false);
        setError('You no longer have access to this group.');
      }
    },
    [id, actor],
  );
  useChatUpdates(refresh, onHint);
  async function run(action: () => Promise<Conversation | void>) {
    if (locked.current) return false;
    locked.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setLoading(false);
    try {
      const result = await action();
      if (!mounted.current || generation.current !== request) return false;
      if (result) setChat(result);
      return true;
    } catch (failure) {
      if (mounted.current && generation.current === request) {
        if (failure instanceof ApiError && (failure.status === 404 || failure.status === 401))
          setChat(null);
        setError(
          `${failure instanceof Error ? failure.message : 'Could not confirm the change.'} Refresh group information before repeating it.`,
        );
      }
      return false;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function confirm(
    label: string,
    detail: string,
    action: () => Promise<Conversation | void>,
    destructive = false,
  ) {
    if (locked.current) return;
    setSelected(null);
    Alert.alert(label, detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: destructive ? 'destructive' : 'default',
        onPress: () => void run(action),
      },
    ]);
  }
  async function messageParticipant(target: string) {
    let directId = '';
    const confirmed = await run(async () => {
      directId = (await chatApi.direct(target)).id;
    });
    if (confirmed) {
      setSelected(null);
      disablePrevention();
      router.push({ pathname: '/chats/[id]', params: { id: directId } });
    }
  }
  const access = chat ? permissions(chat, actor) : null;
  const member = chat?.members.find((item) => item.user.id === selected);
  const actions = chat && member ? participantActions(chat, actor, member.user.id) : [];
  const members =
    chat?.members.filter((item) =>
      item.user.display_name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  const role = (item: Conversation['members'][number]) =>
    item.user.id === chat?.owner_id ? 'Owner' : item.role === 'admin' ? 'Admin' : 'Member';
  const openRename = () => {
    setName(chat?.name ?? '');
    setEditing(true);
    setError('');
  };
  return (
    <Screen>
      {!!error && <Notice error>{error}</Notice>}
      {!chat &&
        (loading ? (
          <ActivityIndicator color={colors.green} accessibilityLabel="Loading group information" />
        ) : (
          <Action label="Retry group information" secondary onPress={refresh} />
        ))}
      {chat?.kind === 'group' && access && (
        <>
          <View style={styles.hero}>
            <ChatAvatar name={chat.name!} group size={96} />
            <Text accessibilityRole="header" style={styles.title}>
              {chat.name}
            </Text>
            <Text style={styles.subtitle}>Group · {chat.members.length} participants</Text>
            <View style={styles.quickActions}>
              <IconButton
                icon="chatbubble-outline"
                label="Open group chat"
                caption="Chat"
                tone="soft"
                size={52}
                disabled={busy}
                onPress={() => router.navigate({ pathname: '/chats/[id]', params: { id } })}
              />
              {!busy && <GroupCallButtons conversationId={id} expanded />}
            </View>
          </View>
          <View style={styles.sectionHeading}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Participants
            </Text>
            <Text style={styles.count}>{chat.members.length} / 50</Text>
          </View>
          <View style={styles.search}>
            <Ionicons name="search-outline" color={colors.muted} size={20} />
            <TextInput
              accessibilityLabel="Search participants"
              placeholder="Search participants"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              style={styles.searchInput}
            />
            {!!query && (
              <IconButton
                icon="close"
                label="Clear participant search"
                size={40}
                onPress={() => setQuery('')}
              />
            )}
          </View>
          <View style={styles.card}>
            {access.admin && (
              <GroupActionRow
                icon="person-add-outline"
                label="Add participants"
                detail={
                  chat.members.length >= 50
                    ? 'This group is full'
                    : 'Choose someone from your conversations'
                }
                disabled={busy || chat.members.length >= 50}
                onPress={() => setInviting(true)}
              />
            )}
            {members.map((item) => (
              <Pressable
                key={item.user.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.user.display_name}${item.user.id === actor ? ', you' : ''}, ${role(item)}, participant actions`}
                disabled={busy}
                onPress={() => setSelected(item.user.id)}
                style={({ pressed }) => [
                  styles.member,
                  pressed && { backgroundColor: colors.pale },
                ]}
              >
                <ChatAvatar name={item.user.display_name} size={46} />
                <View style={styles.identity}>
                  <Text style={styles.name}>
                    {item.user.id === actor ? 'You' : item.user.display_name}
                  </Text>
                  <Text style={styles.memberDetail}>
                    {item.user.id === actor ? `${item.user.display_name} · ` : ''}
                    {item.user.role}
                  </Text>
                </View>
                {item.role === 'admin' && <Text style={styles.badge}>{role(item)}</Text>}
                <Ionicons name="chevron-forward" color={colors.muted} size={16} />
              </Pressable>
            ))}
            {!members.length && (
              <Text style={styles.empty}>No participants match your search.</Text>
            )}
          </View>
          <Text style={styles.footnote}>
            Tap a participant for their actions. New participants can read retained group history.
          </Text>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Group actions
          </Text>
          <View style={styles.card}>
            {access.admin && (
              <GroupActionRow
                icon="pencil-outline"
                label="Edit group name"
                disabled={busy}
                onPress={openRename}
              />
            )}
            <GroupActionRow
              icon="refresh-outline"
              label={loading ? 'Refreshing group…' : 'Refresh group information'}
              disabled={busy || loading}
              onPress={refresh}
            />
            <GroupActionRow
              icon="exit-outline"
              label="Leave group"
              danger
              disabled={busy || !access.canLeave}
              detail={
                access.owner
                  ? 'Transfer ownership from a participant card first'
                  : 'You will lose access to this group'
              }
              onPress={() =>
                confirm(
                  'Leave this group?',
                  'You will no longer be able to read or send messages in this group.',
                  async () => {
                    await chatApi.remove(id);
                    if (!mounted.current) return;
                    setChat(null);
                    setBusy(false);
                    disablePrevention();
                    router.replace('/chats');
                  },
                  true,
                )
              }
            />
          </View>
          {inviting && access.admin && (
            <PeoplePicker
              actor={actor}
              excluded={chat.members.map((item) => item.user.id)}
              max={1}
              selected={[]}
              onCancel={() => setInviting(false)}
              onDone={(people) => {
                setInviting(false);
                if (people[0])
                  confirm(
                    `Add ${people[0].display_name}?`,
                    'They will be able to read retained group history and participate in this group.',
                    () => chatApi.invite(id, people[0]!.id),
                  );
              }}
            />
          )}
          <GroupActionSheet
            title="Edit group name"
            visible={editing && access.admin}
            onClose={() => setEditing(false)}
            busy={busy}
          >
            <Field
              label="Group name"
              value={name}
              onChangeText={setName}
              editable={!busy}
              maxLength={100}
              autoFocus
            />
            {!!error && <Notice error>{error}</Notice>}
            <Action
              label="Save group name"
              busy={busy}
              disabled={!name.trim() || name.trim() === chat.name}
              onPress={() =>
                void run(() => chatApi.rename(id, name)).then((saved) => {
                  if (saved) setEditing(false);
                })
              }
            />
          </GroupActionSheet>
          <GroupActionSheet
            title="Participant"
            visible={!!member}
            onClose={() => setSelected(null)}
            busy={busy}
          >
            {member && (
              <>
                <View style={styles.profile}>
                  <ChatAvatar name={member.user.display_name} size={72} />
                  <Text style={styles.profileName}>
                    {member.user.display_name}
                    {member.user.id === actor ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.subtitle}>
                    {role(member)} · {member.user.role}
                  </Text>
                  <Text style={styles.memberDetail}>
                    Joined {new Date(member.joined_at).toLocaleDateString()}
                  </Text>
                </View>
                {!!error && <Notice error>{error}</Notice>}
                {actions.includes('message') && (
                  <>
                    <GroupActionRow
                      icon="chatbubble-outline"
                      label={`Message ${member.user.display_name}`}
                      disabled={busy}
                      onPress={() => void messageParticipant(member.user.id)}
                    />
                    <View style={styles.callActions}>
                      <CallButtons
                        peerId={member.user.id}
                        compact
                        disabled={busy}
                        onOpen={() => setSelected(null)}
                      />
                    </View>
                  </>
                )}
                {actions.includes('promote') && (
                  <GroupActionRow
                    icon="shield-checkmark-outline"
                    label="Make group admin"
                    disabled={busy}
                    onPress={() =>
                      confirm(
                        `Make ${member.user.display_name} an admin?`,
                        'Admins can edit the group name, add participants and remove ordinary members.',
                        () => chatApi.role(id, member.user.id, 'admin'),
                      )
                    }
                  />
                )}
                {actions.includes('demote') && (
                  <GroupActionRow
                    icon="shield-outline"
                    label="Remove admin role"
                    disabled={busy}
                    onPress={() =>
                      confirm(
                        `Remove ${member.user.display_name}'s admin role?`,
                        'They will remain in the group as a member.',
                        () => chatApi.role(id, member.user.id, 'member'),
                      )
                    }
                  />
                )}
                {actions.includes('transfer') && (
                  <GroupActionRow
                    icon="key-outline"
                    label="Transfer ownership"
                    disabled={busy}
                    onPress={() =>
                      confirm(
                        `Make ${member.user.display_name} the owner?`,
                        'They will control group ownership and admin roles. You will remain an admin.',
                        () => chatApi.transfer(id, member.user.id),
                        true,
                      )
                    }
                  />
                )}
                {actions.includes('remove') && (
                  <GroupActionRow
                    icon="person-remove-outline"
                    label="Remove from group"
                    danger
                    disabled={busy}
                    onPress={() =>
                      confirm(
                        `Remove ${member.user.display_name}?`,
                        'They will lose access to this group and its history.',
                        async () => {
                          await chatApi.remove(id, member.user.id);
                          return chatApi.detail(id);
                        },
                        true,
                      )
                    }
                  />
                )}
                {member.user.id === actor && (
                  <Text style={styles.footnote}>
                    This is your group profile. Use Group actions to manage your membership.
                  </Text>
                )}
              </>
            )}
          </GroupActionSheet>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 8, paddingBottom: 12, gap: 10 },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
  subtitle: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  quickActions: { flexDirection: 'row', justifyContent: 'center', gap: 26, marginTop: 12 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '600' },
  count: { color: colors.muted, fontSize: 13 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    backgroundColor: colors.surface,
    borderRadius: 14,
  },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15, minHeight: 48 },
  card: { backgroundColor: colors.surface, borderRadius: 18, overflow: 'hidden' },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 76,
  },
  identity: { flex: 1, gap: 5 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '500' },
  memberDetail: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
  badge: {
    color: colors.green,
    backgroundColor: colors.pale,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '500',
  },
  footnote: { fontSize: 12, lineHeight: 18, color: colors.muted, paddingHorizontal: 4 },
  empty: { color: colors.muted, padding: 20, textAlign: 'center' },
  profile: { alignItems: 'center', padding: 12, gap: 8 },
  profileName: { fontSize: 21, fontWeight: '600', textAlign: 'center', color: colors.ink },
  callActions: { alignItems: 'center', paddingBottom: 8 },
});
