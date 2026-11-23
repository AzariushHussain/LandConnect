import { useEffect, useState, useSyncExternalStore } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { meetingsApi, session } from '../../application/services';
import { Action, Heading, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { RealtimeNotice } from '../chat/use-chat-updates';
import { memberStatus } from './api';
import { MeetingsInbox } from './inbox';
import { useMeetingUpdates } from './use-meetings';

export function MeetingsScreen() {
  const [inbox] = useState(() => new MeetingsInbox(meetingsApi));
  const state = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
  useMeetingUpdates(inbox.refresh);
  useEffect(() => inbox.stop, [inbox]);
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <FlatList
        data={state.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshing={state.loading}
        onRefresh={() => void inbox.refresh()}
        ListHeaderComponent={
          <View style={styles.section}>
            <Heading
              title="Meetings"
              detail="Invite people, accept invitations and join audio or video together."
            />
            <RealtimeNotice />
            <Action label="Host a meeting" onPress={() => router.push('/meetings/new')} />
            <Action
              label={state.status === 'open' ? 'Show ended meetings' : 'Show open meetings'}
              secondary
              onPress={() => inbox.filter(state.status === 'open' ? 'ended' : 'open')}
            />
            {!!state.error && <Notice error>{state.error}</Notice>}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.title}</Text>
            <Notice>
              {item.kind} -{' '}
              {item.ended_at ? 'Ended' : memberStatus(item, session.access()?.user.id ?? '')} -
              Host: {item.owner.display_name}
            </Notice>
            <Action
              label={`Open ${item.title}`}
              secondary
              onPress={() =>
                router.navigate({ pathname: '/meetings/[id]', params: { id: item.id } })
              }
            />
          </View>
        )}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <Notice>No {state.status} meetings in this list.</Notice>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.section}>
            {!!state.error && (
              <Action label="Retry meetings" secondary onPress={() => void inbox.refresh()} />
            )}
            {state.hasMore && (
              <Action
                label="Load more meetings"
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
  content: { padding: 20, gap: 16 },
  section: { gap: 12 },
  card: { padding: 20, gap: 10, backgroundColor: colors.surface, borderRadius: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink },
});
