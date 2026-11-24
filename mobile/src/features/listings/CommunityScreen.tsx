import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listingsApi } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { IconButton } from '../../ui/IconButton';
import { colors } from '../../ui/theme';
import { ListingFeed } from './feed';
import {
  emptyFilters,
  filterFields,
  ListingFilters,
  normalizeFilters,
  withoutFilter,
} from './filters';
import { ListingCard } from './ListingCard';
import { ListingFiltersSheet } from './ListingFiltersSheet';

export function CommunityScreen() {
  const [feed] = useState(() => new ListingFeed(listingsApi));
  const state = useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  const [query, setQuery] = useState(''),
    [expanded, setExpanded] = useState(false),
    [formError, setFormError] = useState('');
  useEffect(() => {
    void feed.refresh();
    return feed.invalidate;
  }, [feed]);
  const busy = state.status === 'loading' || state.status === 'refreshing';
  const active = filterFields.filter(([key]) => !!state.filters[key]);
  function apply(input: ListingFilters) {
    try {
      const filters = normalizeFilters(input);
      Keyboard.dismiss();
      setQuery(filters.q);
      setFormError('');
      setExpanded(false);
      void feed.apply(filters);
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Check your filters.');
    }
  }
  const clear = () => apply({ ...emptyFilters });
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.searchPanel}>
          <Text style={styles.title}>Explore properties</Text>
          <Text style={styles.subtitle}>Find land. Discover your next opportunity.</Text>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={21} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="City, title or keyword"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Search properties"
                maxLength={100}
                returnKeyType="search"
                autoCorrect={false}
                onSubmitEditing={() => apply({ ...state.filters, q: query })}
                style={styles.input}
              />
              {query ? (
                <IconButton
                  icon="close"
                  label="Clear property search"
                  size={40}
                  onPress={() => apply({ ...state.filters, q: '' })}
                />
              ) : null}
              <IconButton
                icon="arrow-forward"
                label="Search properties"
                tone="soft"
                size={40}
                busy={busy}
                onPress={() => apply({ ...state.filters, q: query })}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Filters${active.length ? `, ${active.length} active` : ''}`}
              onPress={() => {
                Keyboard.dismiss();
                setExpanded(true);
              }}
              style={styles.filterButton}
            >
              <Ionicons name="options-outline" size={24} color={colors.green} />
              {!!active.length && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{active.length}</Text>
                </View>
              )}
            </Pressable>
          </View>
          {!!formError && <Notice error>{formError}</Notice>}
          {!!active.length && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {active.map(([key, label]) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${label} filter`}
                  onPress={() => apply(withoutFilter(state.filters, key))}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>
                    {label}: {state.filters[key]}
                  </Text>
                  <Ionicons name="close" size={15} color={colors.green} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ListingCard listing={item} />}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
          refreshing={state.status === 'refreshing'}
          onRefresh={() => void feed.refresh(true)}
          alwaysBounceVertical
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View style={styles.results}>
              <View style={styles.resultsRow}>
                <Text style={styles.count} accessibilityLiveRegion="polite">
                  {busy
                    ? 'Finding properties…'
                    : state.status === 'error'
                      ? 'Unable to update results'
                      : `${state.total} ${state.total === 1 ? 'property' : 'properties'}`}
                </Text>
              </View>
              {(active.length > 0 || !!state.filters.q) && (
                <Pressable accessibilityRole="button" onPress={clear} style={styles.clear}>
                  <Text style={styles.clearText}>Clear search and filters</Text>
                </Pressable>
              )}
              {state.status === 'error' && (
                <View style={styles.error}>
                  <Notice error>
                    {state.error}
                    {state.items.length ? ' Previous results are shown below.' : ''}
                  </Notice>
                  <Action label="Retry properties" secondary onPress={() => void feed.refresh()} />
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            state.status === 'ready' ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="search-outline" size={32} color={colors.green} />
                </View>
                <Text style={styles.emptyTitle}>No properties found</Text>
                <Text style={styles.emptyDetail}>
                  Try another location or adjust your budget and area.
                </Text>
                {(active.length > 0 || !!state.filters.q) && (
                  <Action label="Clear search and filters" secondary onPress={clear} />
                )}
              </View>
            ) : undefined
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {state.status === 'loading' && (
                <ActivityIndicator
                  size="large"
                  color={colors.green}
                  accessibilityLabel="Loading properties"
                />
              )}
              {state.status === 'ready' && !!state.error && <Notice error>{state.error}</Notice>}
              {state.hasMore && state.status !== 'error' && (
                <Action
                  label={state.error ? 'Retry loading more' : 'Load more properties'}
                  busy={state.status === 'loadingMore'}
                  secondary
                  onPress={() => void feed.more()}
                />
              )}
              {state.capped && <Notice>Refine your search to see more properties.</Notice>}
            </View>
          }
        />
        {expanded && (
          <ListingFiltersSheet
            value={{ ...state.filters, q: query }}
            onClose={() => setExpanded(false)}
            onApply={apply}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  searchPanel: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 10 },
  title: { color: colors.ink, fontSize: 26, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 13 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 6,
    gap: 5,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, minHeight: 52, color: colors.ink, fontSize: 14 },
  filterButton: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -3,
    top: -5,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  chips: { gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.pale,
    minHeight: 44,
  },
  chipText: { color: colors.green, fontSize: 12 },
  list: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  results: { gap: 8, marginBottom: 14 },
  resultsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  count: { color: colors.muted, fontSize: 14, fontWeight: '500', flex: 1 },
  clear: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  clearText: { color: colors.green, fontWeight: '500', fontSize: 13 },
  error: { gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 14 },
  emptyIcon: {
    height: 72,
    width: 72,
    borderRadius: 36,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.ink, fontSize: 21, fontWeight: '600' },
  emptyDetail: { color: colors.muted, textAlign: 'center', lineHeight: 21, fontSize: 14 },
  footer: { paddingVertical: 20, gap: 12 },
});
