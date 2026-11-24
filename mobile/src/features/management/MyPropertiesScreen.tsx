import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { managementApi, session } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ListingFeed } from '../listings/feed';
import { ListingRecord } from '../listings/types';
import { StatusFilter } from './api';
import { OwnedPropertyCard } from './OwnedPropertyCard';

const filters = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'active', label: 'Active' },
  { value: 'sold', label: 'Sold' },
  { value: 'archived', label: 'Archived' },
] as const;

export function MyPropertiesScreen({ actor }: { actor: string }) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const feed = useMemo(
    () =>
      new ListingFeed<ListingRecord>({
        page: (_, offset, limit) => managementApi.mine(status, offset, limit),
      }),
    [status],
  );
  const state = useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      void feed.refresh();
      return feed.invalidate;
    }, [feed]),
  );
  const access = session.access();
  if (!access || access.user.id !== actor) return null;
  const busy = state.status === 'loading' || state.status === 'refreshing';
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.top}>
          <View style={styles.heading}>
            <Text style={styles.total} accessibilityLiveRegion="polite">
              {busy
                ? 'Updating listings…'
                : `${state.total} ${state.total === 1 ? 'property' : 'properties'}`}
            </Text>
            <Text style={styles.subtitle}>Keep your listings up to date.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a property"
            onPress={() => router.push('/manage/new')}
            style={({ pressed }) => [styles.add, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="add" color="#FFFFFF" size={20} />
            <Text style={styles.addText}>Add property</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {filters.map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityLabel={`${item.label} properties`}
              accessibilityState={{ selected: status === item.value }}
              onPress={() => setStatus(item.value)}
              style={[styles.filter, status === item.value && styles.selected]}
            >
              <Text style={[styles.filterText, status === item.value && { color: '#FFFFFF' }]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={state.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) =>
          item.owner.id === actor ? <OwnedPropertyCard listing={item} token={access.token} /> : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
        refreshing={state.status === 'refreshing'}
        onRefresh={() => void feed.refresh(true)}
        alwaysBounceVertical
        ListHeaderComponent={
          state.status === 'error' ? (
            <View style={styles.message}>
              <Notice error>
                {state.error}
                {state.items.length ? ' Showing previously loaded properties.' : ''}
              </Notice>
              <Action
                label="Retry loading properties"
                secondary
                onPress={() => void feed.refresh()}
              />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          state.status === 'ready' ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="home-outline" size={34} color={colors.green} />
              </View>
              <Text style={styles.emptyTitle}>
                {status === 'all' ? 'Your listings start here' : `No ${status} properties`}
              </Text>
              <Text style={styles.emptyDetail}>
                {status === 'all'
                  ? 'Create a draft, add your photos and publish when you are ready.'
                  : 'Choose another status to see your other listings.'}
              </Text>
              {status === 'all' ? (
                <Action
                  label="Create your first property"
                  onPress={() => router.push('/manage/new')}
                />
              ) : (
                <Action label="Show all properties" secondary onPress={() => setStatus('all')} />
              )}
            </View>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {state.status === 'loading' && (
              <ActivityIndicator
                color={colors.green}
                accessibilityLabel="Loading your properties"
              />
            )}
            {state.status === 'ready' && !!state.error && <Notice error>{state.error}</Notice>}
            {state.hasMore && state.status !== 'error' && (
              <Action
                label={state.error ? 'Retry loading more properties' : 'Load more properties'}
                secondary
                busy={state.status === 'loadingMore'}
                disabled={busy}
                onPress={() => void feed.more()}
              />
            )}
            {state.capped && <Notice>Choose a status to narrow your property list.</Notice>}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 12, paddingBottom: 16, paddingHorizontal: 20, gap: 18 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  heading: { gap: 7, flexGrow: 1 },
  total: { color: colors.ink, fontSize: 23, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 12 },
  add: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 15,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  addText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  filters: { gap: 8 },
  filter: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.green },
  filterText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  message: { gap: 12, marginBottom: 18 },
  empty: { alignItems: 'center', paddingVertical: 42, gap: 14 },
  emptyIcon: {
    height: 76,
    width: 76,
    borderRadius: 38,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.ink, fontSize: 21, fontWeight: '600', textAlign: 'center' },
  emptyDetail: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  footer: { paddingVertical: 20, gap: 12 },
});
