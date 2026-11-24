import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { callsApi, realtime } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ChatAvatar } from '../chat/ChatAvatar';
import { CallHistory, historyLabel } from './history';
import { CallButtons } from './CallButtons';
import { GroupCallButtons } from './GroupCallButtons';

export function CallHistoryScreen({ actor }: { actor: string }) {
  const [history] = useState(() => new CallHistory(callsApi));
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      let debounce: ReturnType<typeof setTimeout>;
      const refresh = () => {
        if (AppState.currentState === 'active') void history.refresh();
      };
      const hint = () => {
        clearTimeout(debounce);
        debounce = setTimeout(refresh, 200);
      };
      refresh();
      const callEvents = realtime.onCallHint(hint),
        groupEvents = realtime.onMeetingHint(hint);
      const chatEvents = realtime.onHint((event) => {
        if (event.type === 'membership.removed' && event.target_user_id === actor)
          history.revoke(event.conversation_id);
        hint();
      });
      const timer = setInterval(refresh, 15000);
      const app = AppState.addEventListener('change', (value) => {
        if (value === 'active') refresh();
      });
      return () => {
        clearInterval(timer);
        clearTimeout(debounce);
        callEvents();
        groupEvents();
        chatEvents();
        app.remove();
        history.stop();
      };
    }, [history, actor]),
  );
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Call history</Text>
        <Text style={styles.subtitle}>Your direct and group calls, most recent first.</Text>
        <View style={styles.filters}>
          {[false, true].map((missed) => (
            <Pressable
              key={String(missed)}
              accessibilityRole="button"
              accessibilityState={{ selected: state.missed === missed }}
              onPress={() => void history.filter(missed)}
              style={[styles.filter, state.missed === missed && styles.active]}
            >
              <Text style={[styles.filterText, state.missed === missed && { color: '#FFFFFF' }]}>
                {missed ? 'Missed' : 'All calls'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={state.items}
        keyExtractor={(item) => `${item.source}:${item.id}`}
        contentContainerStyle={styles.list}
        refreshing={state.status === 'refreshing' || state.status === 'loading'}
        onRefresh={() => void history.refresh()}
        alwaysBounceVertical
        renderItem={({ item }) => {
          const missed =
            item.source === 'direct' && item.status === 'missed' && item.direction === 'incoming';
          return (
            <View style={styles.row}>
              <ChatAvatar name={item.title} group={item.source === 'group'} size={48} />
              <View style={styles.identity}>
                <Text numberOfLines={1} style={[styles.name, missed && { color: colors.error }]}>
                  {item.title}
                </Text>
                <View style={styles.status}>
                  <Feather
                    name={item.direction === 'incoming' ? 'arrow-down-left' : 'arrow-up-right'}
                    size={14}
                    color={missed ? colors.error : colors.green}
                  />
                  <Text style={styles.detail}>
                    {historyLabel(item)} · {item.kind}
                  </Text>
                </View>
                <Text style={styles.date}>
                  {new Date(item.created_at).toLocaleString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              {item.peer ? (
                <CallButtons peerId={item.peer.id} compact />
              ) : (
                <GroupCallButtons conversationId={item.conversation_id!} />
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          state.status === 'ready' ? (
            <View style={styles.empty}>
              <Ionicons name="call-outline" size={42} color={colors.green} />
              <Text style={styles.emptyTitle}>
                {state.missed ? 'No missed calls' : 'No calls yet'}
              </Text>
              <Text style={styles.subtitle}>Calls you make or receive will appear here.</Text>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {state.status === 'loading' && (
              <ActivityIndicator color={colors.green} accessibilityLabel="Loading call history" />
            )}
            {!!state.error && (
              <>
                <Notice error>{state.error}</Notice>
                <Action
                  label="Retry call history"
                  secondary
                  onPress={() => void history.refresh()}
                />
              </>
            )}
            {state.hasMore && (
              <Action
                label="Load older calls"
                secondary
                busy={state.status === 'more'}
                disabled={state.status === 'refreshing'}
                onPress={() => void history.more()}
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
  header: { padding: 20, gap: 10 },
  title: { color: colors.ink, fontSize: 26, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  filters: { flexDirection: 'row', gap: 10, marginTop: 6 },
  filter: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pale,
  },
  active: { backgroundColor: colors.green },
  filterText: { color: colors.green, fontWeight: '500', fontSize: 14 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  identity: { flex: 1, gap: 6 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '500' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detail: { flex: 1, color: colors.muted, fontSize: 11 },
  date: { color: colors.muted, fontSize: 11 },
  footer: { padding: 16, gap: 12 },
  empty: { alignItems: 'center', gap: 14, paddingVertical: 60 },
  emptyTitle: { color: colors.ink, fontSize: 21, fontWeight: '600' },
});
