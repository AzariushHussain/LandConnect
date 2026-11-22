import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { managementApi } from '../../application/services';
import { Action, Heading, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ListingFeed } from '../listings/feed';
import { formatDecimal } from '../listings/filters';
import { ListingRecord } from '../listings/types';
import { StatusFilter } from './api';

export function MyPropertiesScreen() {
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
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <FlatList
        data={state.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshing={state.status === 'refreshing'}
        onRefresh={() => void feed.refresh()}
        ListHeaderComponent={
          <View style={styles.section}>
            <Heading
              title="My properties"
              detail="Create a draft, add photos, then publish it to the community."
            />
            <Action label="Add a property" onPress={() => router.push('/manage/new')} />
            <View style={styles.filters}>
              {(['all', 'draft', 'active', 'sold', 'archived'] as const).map((value) => (
                <View key={value} style={styles.filter}>
                  <Action
                    label={value === status ? `${value} · selected` : value}
                    secondary={value !== status}
                    onPress={() => setStatus(value)}
                  />
                </View>
              ))}
            </View>
            <Notice>
              {state.total} {status === 'all' ? '' : `${status} `}properties
            </Notice>
            {!!state.error && <Notice error>{state.error}</Notice>}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.status}>{item.status}</Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.text}>
              {item.city}, {item.state}
            </Text>
            <Text style={styles.text}>
              {item.currency} {formatDecimal(item.price)}
            </Text>
            <Action
              label={`Edit ${item.title}`}
              secondary
              onPress={() => router.push({ pathname: '/manage/[id]', params: { id: item.id } })}
            />
          </View>
        )}
        ListEmptyComponent={
          state.status === 'loading' ? (
            <ActivityIndicator color={colors.green} accessibilityLabel="Loading your properties" />
          ) : state.status !== 'error' ? (
            <Notice>No properties in this category yet.</Notice>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.section}>
            {state.status === 'error' && (
              <Action label="Retry loading properties" onPress={() => void feed.refresh()} />
            )}
            {state.hasMore && (
              <Action
                label="Load more"
                secondary
                busy={state.status === 'loadingMore'}
                onPress={() => void feed.more()}
              />
            )}
            {state.capped && <Notice>Refresh or choose a status to narrow this list.</Notice>}
          </View>
        }
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  section: { gap: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { minWidth: '45%', flexGrow: 1 },
  card: {
    padding: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    gap: 12,
  },
  status: { color: colors.green, textTransform: 'capitalize', fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink },
  text: { color: colors.muted, fontSize: 16 },
});
