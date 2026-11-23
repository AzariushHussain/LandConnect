import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatApi } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Heading, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { Inbox } from './inbox';
import { title } from './types';
import { RealtimeNotice, useChatUpdates } from './use-chat-updates';

export function InboxScreen() {
  const session = useSession();
  const [inbox] = useState(() => new Inbox(chatApi));
  const state = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
  useChatUpdates(inbox.refresh);
  useEffect(() => inbox.stop, [inbox]);
  if (session.status !== 'signedIn') return null;
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <FlatList
        data={state.items}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={styles.content}
        refreshing={state.loading}
        onRefresh={() => void inbox.refresh()}
        ListHeaderComponent={
          <View style={styles.section}>
            <Heading
              title="Your conversations"
              detail="Message a property owner from their listing, or create a group with people you already know here."
            />
            <RealtimeNotice />
            <Action label="Create a group" onPress={() => router.push('/chats/new-group')} />
            <Action
              label="Meetings and invitations"
              secondary
              onPress={() => router.push('/meetings')}
            />
            {!!state.error && <Notice error>{state.error}</Notice>}
            {state.loading && (
              <ActivityIndicator color={colors.green} accessibilityLabel="Loading conversations" />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{title(item, session.user.id)}</Text>
            <Notice>
              {item.kind === 'group' ? `${item.members.length} members` : 'Direct conversation'}
            </Notice>
            <Action
              label={`Open ${title(item, session.user.id)}`}
              secondary
              onPress={() => router.push({ pathname: '/chats/[id]', params: { id: item.id } })}
            />
          </View>
        )}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <Notice>No conversations yet. Open a property and tap Message owner.</Notice>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.section}>
            {!!state.error && (
              <Action
                label="Refresh conversations"
                secondary
                onPress={() => void inbox.refresh()}
              />
            )}
            {state.hasMore && (
              <Action
                label="Load more conversations"
                secondary
                busy={state.more}
                onPress={() => void inbox.more()}
              />
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center' },
  section: { gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
  },
  name: { fontSize: 20, fontWeight: '700', color: colors.ink },
});
