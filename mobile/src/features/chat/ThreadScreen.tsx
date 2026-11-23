import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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

export function ThreadScreen({ id, actor }: { id: string; actor: string }) {
  const [thread] = useState(() => new Thread(id, actor, chatApi, randomUUID));
  const state = useSyncExternalStore(thread.subscribe, thread.getSnapshot);
  const [discard, setDiscard] = useState(false);
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
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{state.chat ? title(state.chat, actor) : 'Conversation'}</Text>
          <RealtimeNotice />
          {!!state.error && <Notice error>{state.error}</Notice>}
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
              onPress={() => router.push({ pathname: '/chats/[id]/info', params: { id } })}
            />
          )}
        </View>
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
                <Text style={styles.sender}>
                  {item.sender.id === actor ? 'You' : item.sender.display_name}
                </Text>
                <Text selectable style={styles.body}>
                  {item.body}
                </Text>
                <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
            )}
            ListEmptyComponent={
              !state.unavailable ? <Notice>No messages yet. Say hello.</Notice> : undefined
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
            <Action
              label={state.attempt ? 'Retry same message' : 'Send message'}
              busy={!!state.attempt?.sending}
              disabled={state.loading || !state.draft.trim()}
              onPress={() => void thread.send()}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  title: { fontSize: 21, fontWeight: '700', color: colors.ink },
  messages: { padding: 16, gap: 12, flexGrow: 1 },
  bubble: {
    maxWidth: '90%',
    alignSelf: 'flex-start',
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    gap: 6,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.pale },
  sender: { color: colors.green, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  time: { color: colors.muted, fontSize: 11 },
  composer: { padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: colors.border },
  input: {
    maxHeight: 120,
    minHeight: 50,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
