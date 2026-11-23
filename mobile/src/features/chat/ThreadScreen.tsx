import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, usePreventRemove } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatApi } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { Thread } from './thread';
import { ChatHint } from './realtime';
import { title } from './types';
import { RealtimeNotice, useChatUpdates } from './use-chat-updates';
import { BlockButton } from '../privacy/BlockButton';
import { CallButtons } from '../calls/CallButtons';
import { ChatAvatar } from './ChatAvatar';
import { IconButton } from '../../ui/IconButton';
import { GroupCallButtons } from '../calls/GroupCallButtons';

export function ThreadScreen({ id, actor }: { id: string; actor: string }) {
  const [thread] = useState(() => new Thread(id, actor, chatApi, randomUUID));
  const state = useSyncExternalStore(thread.subscribe, thread.getSnapshot);
  const [discard, setDiscard] = useState(false);
  const [options, setOptions] = useState(false);
  const hint = useCallback(
    (event: ChatHint) => {
      if (
        event.type === 'membership.removed' &&
        event.conversation_id === id &&
        event.target_user_id === actor
      )
        thread.deny();
    },
    [id, actor, thread],
  );
  useChatUpdates(thread.sync, hint);
  useEffect(() => thread.stop, [thread]);
  usePreventRemove(!discard && (!!state.draft || !!state.attempt), ({ repeat }) => {
    if (state.attempt?.sending) {
      Alert.alert('Please wait', 'Wait for the send attempt to finish.');
      return;
    }
    Alert.alert(
      'Leave this chat?',
      'Your draft and any unconfirmed retry are only stored in memory. Check history before resending after you leave.',
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
  });
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <IconButton
              icon="arrow-back"
              label="Back to chats"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
            />
            <ChatAvatar
              name={state.chat ? title(state.chat, actor) : 'Conversation'}
              group={state.chat?.kind === 'group'}
              size={42}
            />
            <View style={styles.identity}>
              <Text numberOfLines={1} style={styles.title}>
                {state.chat ? title(state.chat, actor) : 'Conversation'}
              </Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {state.chat?.kind === 'group'
                  ? `${state.chat.members.length} participants`
                  : 'LandConnect chat'}
              </Text>
            </View>
            {state.chat?.kind === 'direct' &&
              !state.unavailable &&
              state.chat.members
                .filter((member) => member.user.id !== actor)
                .map((member) => (
                  <CallButtons key={member.user.id} peerId={member.user.id} compact />
                ))}
            {state.chat?.kind === 'group' && !state.unavailable && (
              <GroupCallButtons conversationId={id} />
            )}
            <IconButton
              icon="ellipsis-vertical"
              label="Conversation options"
              onPress={() => setOptions(true)}
            />
          </View>
          {!!state.error && <Notice error>{state.error}</Notice>}
        </View>
        <Modal
          visible={options}
          transparent
          animationType="fade"
          onRequestClose={() => setOptions(false)}
        >
          <View style={styles.overlay}>
            <View style={styles.menu}>
              <Text style={styles.title}>Conversation options</Text>
              <RealtimeNotice />
              {state.chat?.kind === 'direct' &&
                state.chat.members
                  .filter((member) => member.user.id !== actor)
                  .map((member) => <BlockButton key={member.user.id} peer={member.user} />)}
              {!state.unavailable && (
                <Action
                  label={state.moreNew ? 'Load more new messages' : 'Refresh chat'}
                  secondary
                  busy={state.syncing}
                  onPress={() => void thread.sync()}
                />
              )}
              {state.chat?.kind === 'group' && (
                <Action
                  label="Group information"
                  secondary
                  onPress={() => {
                    setOptions(false);
                    router.push({ pathname: '/chats/[id]/info', params: { id } });
                  }}
                />
              )}
              <Action label="Close options" secondary onPress={() => setOptions(false)} />
            </View>
          </View>
        </Modal>
        {state.loading ? (
          <ActivityIndicator color={colors.green} accessibilityLabel="Loading message history" />
        ) : (
          <FlatList
            inverted
            data={[...state.messages].reverse()}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.sender.id === actor && styles.mine]}>
                {item.sender.id !== actor && state.chat?.kind === 'group' && (
                  <Text style={styles.sender}>{item.sender.display_name}</Text>
                )}
                <Text selectable style={styles.body}>
                  {item.body}
                </Text>
                <Text style={styles.time}>
                  {new Date(item.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              !state.unavailable ? (
                <View>
                  <Notice>No messages yet. Say hello.</Notice>
                </View>
              ) : undefined
            }
            ListFooterComponent={
              state.before !== null ? (
                <Action
                  label="Load older messages"
                  secondary
                  busy={state.older}
                  onPress={() => void thread.older()}
                />
              ) : undefined
            }
          />
        )}
        {!state.unavailable && (
          <View style={styles.composer}>
            {state.attempt && (
              <>
                <Notice error={!!state.attempt.error}>
                  {state.attempt.sending ? 'Sending…' : state.attempt.error}
                </Notice>
                {!state.attempt.sending && (
                  <Action
                    label="Discard local attempt"
                    secondary
                    onPress={() =>
                      Alert.alert(
                        'Discard this local attempt?',
                        'It may already be saved on the server. Refresh history before sending the same text again.',
                        [
                          { text: 'Keep', style: 'cancel' },
                          { text: 'Discard', style: 'destructive', onPress: thread.discard },
                        ],
                      )
                    }
                  />
                )}
              </>
            )}
            <View style={styles.composerRow}>
              <TextInput
                accessibilityLabel="Message text"
                multiline
                maxLength={8000}
                editable={!state.loading && !state.attempt}
                value={state.draft}
                onChangeText={thread.draft}
                placeholder="Write a message"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <IconButton
                icon="send"
                tone="success"
                size={52}
                label={state.attempt ? 'Retry same message' : 'Send message'}
                busy={!!state.attempt?.sending}
                disabled={state.loading || !state.draft.trim()}
                onPress={() => void thread.send()}
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  identity: { flex: 1, marginLeft: 7, gap: 4 },
  title: { fontSize: 17, fontWeight: '600', color: colors.ink },
  subtitle: { fontSize: 12, color: colors.muted },
  overlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#00000066' },
  menu: { padding: 22, gap: 14, borderRadius: 20, backgroundColor: colors.surface },
  messages: { padding: 16, gap: 12, flexGrow: 1 },
  bubble: {
    maxWidth: '90%',
    alignSelf: 'flex-start',
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    gap: 6,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: '#DDF3D7', borderTopRightRadius: 4 },
  sender: { color: colors.green, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  time: { color: colors.muted, fontSize: 11 },
  composer: { padding: 12, gap: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: {
    maxHeight: 120,
    flex: 1,
    minHeight: 50,
    padding: 12,
    borderRadius: 24,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
