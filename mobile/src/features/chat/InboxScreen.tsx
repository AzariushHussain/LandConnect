import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatApi } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Notice } from '../../ui/components';
import { IconButton } from '../../ui/IconButton';
import { colors } from '../../ui/theme';
import { Inbox } from './inbox';
import { title } from './types';
import { RealtimeNotice, useChatUpdates } from './use-chat-updates';
import { ChatAvatar } from './ChatAvatar';
import { RecipientSearch } from './recipient-search';

export function InboxScreen() {
  const session = useSession();
  const [inbox] = useState(() => new Inbox(chatApi));
  const [search] = useState(() => new RecipientSearch(chatApi));
  const state = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
  const lookup = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const searching = !!lookup.query.trim();
  useChatUpdates(inbox.refresh);
  useEffect(() => inbox.stop, [inbox]);
  useFocusEffect(useCallback(() => () => search.stop(), [search]));
  useEffect(() => {
    if (Array.from(lookup.query.trim()).length < 2) return;
    const timer = setTimeout(() => void search.search(), 300);
    return () => clearTimeout(timer);
  }, [search, lookup.query]);
  if (session.status !== 'signedIn') return null;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.section}>
        <View style={styles.toolbar}>
          <Text style={styles.heading}>Chats</Text>
          <IconButton
            icon="people-outline"
            label="Create a group"
            onPress={() => router.push('/chats/new-group')}
          />
        </View>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={21} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search people by email or name"
            placeholder="Search by email or name"
            placeholderTextColor={colors.muted}
            value={lookup.query}
            onChangeText={search.setQuery}
            editable={!lookup.opening}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            returnKeyType="search"
            onSubmitEditing={() => void search.search()}
            style={styles.searchInput}
          />
          {!!lookup.query && (
            <IconButton
              icon="close"
              label="Clear people search"
              disabled={!!lookup.opening}
              onPress={() => search.setQuery('')}
            />
          )}
        </View>
      </View>
      {searching ? (
        <FlatList
          data={lookup.items}
          keyExtractor={(person) => person.id}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.searchStatus}>
              <Text style={styles.preview}>People · use a full email address or profile name</Text>
              {lookup.loading && (
                <ActivityIndicator color={colors.green} accessibilityLabel="Searching people" />
              )}
              {!!lookup.error && (
                <>
                  <Notice error>{lookup.error}</Notice>
                  {!lookup.items.length && (
                    <Action label="Retry search" secondary onPress={() => void search.search()} />
                  )}
                </>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open chat with ${item.display_name}`}
              accessibilityState={{ disabled: !!lookup.opening, busy: lookup.opening === item.id }}
              disabled={!!lookup.opening}
              onPress={() => {
                void search.open(item.id).then((chat) => {
                  if (chat) router.push({ pathname: '/chats/[id]', params: { id: chat.id } });
                });
              }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.pale }]}
            >
              <ChatAvatar name={item.display_name} />
              <View style={styles.summary}>
                <Text numberOfLines={1} style={styles.name}>
                  {item.display_name}
                </Text>
                <Text style={styles.preview}>
                  {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
                </Text>
              </View>
              {lookup.opening === item.id && (
                <ActivityIndicator color={colors.green} accessibilityLabel="Opening chat" />
              )}
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            !lookup.loading && !lookup.error ? (
              <View style={styles.searchStatus}>
                <Notice>
                  {Array.from(lookup.query.trim()).length < 2
                    ? 'Type at least 2 characters to find someone.'
                    : 'No available people found. Try their full email address or profile name.'}
                </Notice>
              </View>
            ) : undefined
          }
          ListFooterComponent={
            lookup.hasMore ? (
              <View style={styles.searchStatus}>
                <Notice>More people match. Refine your search to find them.</Notice>
              </View>
            ) : undefined
          }
        />
      ) : (
        <FlatList
          data={state.items}
          keyExtractor={(chat) => chat.id}
          contentContainerStyle={styles.content}
          refreshing={state.loading}
          onRefresh={() => void inbox.refresh()}
          ListHeaderComponent={
            <View style={styles.section}>
              <RealtimeNotice />
              {!!state.error && <Notice error>{state.error}</Notice>}
              {state.loading && (
                <ActivityIndicator
                  color={colors.green}
                  accessibilityLabel="Loading conversations"
                />
              )}
            </View>
          }
          renderItem={({ item }) => {
            const name = title(item, session.user.id);
            const peer = item.members.find((member) => member.user.id !== session.user.id)?.user;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Chat with ${name}`}
                onPress={() => router.push({ pathname: '/chats/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.pale }]}
              >
                <ChatAvatar name={name} group={item.kind === 'group'} />
                <View style={styles.summary}>
                  <Text numberOfLines={1} style={styles.name}>
                    {name}
                  </Text>
                  <Text numberOfLines={1} style={styles.preview}>
                    {item.kind === 'group'
                      ? `${item.members.length} participants · Group chat`
                      : `${peer?.role ? peer.role.charAt(0).toUpperCase() + peer.role.slice(1) : 'LandConnect'} · Message privately`}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            !state.loading && !state.error ? (
              <View style={styles.searchStatus}>
                <Notice>No conversations yet. Search above to start a chat.</Notice>
              </View>
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
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, paddingBottom: 20, width: '100%' },
  section: { gap: 10, padding: 18 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 26,
    backgroundColor: colors.pale,
    paddingLeft: 14,
    minHeight: 50,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.ink,
    fontSize: 16,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  searchStatus: { paddingHorizontal: 18, paddingVertical: 10, gap: 10 },
  heading: { fontSize: 28, color: colors.ink, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    minHeight: 88,
    gap: 14,
  },
  summary: { flex: 1, gap: 6 },
  name: { fontSize: 17, fontWeight: '600', color: colors.ink },
  preview: { fontSize: 14, color: colors.muted },
  separator: { marginLeft: 88, backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
});
