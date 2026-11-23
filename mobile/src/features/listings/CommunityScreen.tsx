import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listingsApi } from '../../application/services';
import { Action, Field, Heading, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ListingFeed } from './feed';
import { emptyFilters, ListingFilters, normalizeFilters } from './filters';
import { ListingCard } from './ListingCard';

const filterFields = [
  ['city', 'City'],
  ['state', 'State'],
  ['country', 'Country code (e.g. IN)'],
  ['currency', 'Currency code (e.g. INR)'],
  ['min_price', 'Minimum price'],
  ['max_price', 'Maximum price'],
  ['min_area', 'Minimum area (m²)'],
  ['max_area', 'Maximum area (m²)'],
] as const;

export function CommunityScreen() {
  const [feed] = useState(() => new ListingFeed(listingsApi));
  const state = useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  const [draft, setDraft] = useState<ListingFilters>({ ...emptyFilters });
  const [expanded, setExpanded] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    void feed.refresh();
    return feed.invalidate;
  }, [feed]);
  const busy = state.status === 'loading' || state.status === 'refreshing';
  const active = Object.values(state.filters).filter(Boolean).length;

  function search(clear = false) {
    try {
      const filters = normalizeFilters(clear ? { ...emptyFilters } : draft);
      Keyboard.dismiss();
      setDraft(filters);
      setFormError('');
      setExpanded(false);
      void feed.apply(filters);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Check your filters.');
    }
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.top}>
        <Text style={styles.eyebrow}>LANDCONNECT COMMUNITY</Text>
      </View>
      <Heading
        title="Find your next place."
        detail="Explore land and connect with its community."
      />
      <Field
        label="Search properties"
        placeholder="Title, description or city"
        value={draft.q}
        maxLength={100}
        onChangeText={(q) => setDraft({ ...draft, q })}
        returnKeyType="search"
        onSubmitEditing={() => search()}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={styles.filterToggle}
      >
        <Text style={styles.accountLabel}>
          {expanded ? 'Hide filters' : 'Show filters'}
          {active ? ` · ${active} active` : ''}
        </Text>
      </Pressable>
      {expanded && (
        <View style={styles.filters}>
          {filterFields.map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={draft[key]}
              maxLength={
                key === 'country'
                  ? 2
                  : key === 'currency'
                    ? 3
                    : key.startsWith('min_') || key.startsWith('max_')
                      ? 15
                      : 100
              }
              keyboardType={
                key.startsWith('min_') || key.startsWith('max_') ? 'decimal-pad' : 'default'
              }
              autoCapitalize={key === 'country' || key === 'currency' ? 'characters' : 'words'}
              autoCorrect={false}
              onChangeText={(value) => setDraft({ ...draft, [key]: value })}
            />
          ))}
          <Notice>Prices use the selected currency. Areas are in square metres.</Notice>
        </View>
      )}
      {!!formError && <Notice error>{formError}</Notice>}
      <Action label="Search properties" onPress={() => search()} busy={busy} />
      <Action
        label="Explore properties on map"
        secondary
        onPress={() =>
          router.navigate({ pathname: '/map', params: { filters: JSON.stringify(state.filters) } })
        }
      />
      {(active > 0 || Object.values(draft).some(Boolean)) && (
        <Action label="Clear search and filters" onPress={() => search(true)} secondary />
      )}
      <Text style={styles.count} accessibilityLiveRegion="polite">
        {busy
          ? 'Finding properties…'
          : state.status === 'error'
            ? state.items.length
              ? 'Showing previous results'
              : 'Properties could not be loaded'
            : `${state.total} ${state.total === 1 ? 'property' : 'properties'} found`}
      </Text>
      {state.status === 'error' && (
        <View style={styles.message}>
          <Notice error>{state.error}</Notice>
          <Action label="Retry properties" secondary onPress={() => void feed.refresh()} />
        </View>
      )}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {state.status === 'loading' && (
        <ActivityIndicator
          size="large"
          color={colors.green}
          accessibilityLabel="Loading properties"
        />
      )}
      {state.status === 'ready' && state.error && <Notice error>{state.error}</Notice>}
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
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ListingCard listing={item} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ItemSeparatorComponent={Separator}
          refreshing={state.status === 'refreshing'}
          onRefresh={() => void feed.refresh()}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            state.status === 'ready' ? (
              <View style={styles.empty}>
                <Heading
                  title="No properties found."
                  detail="Try a different search or clear your filters."
                />
              </View>
            ) : undefined
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={{ height: 20 }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 32,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  header: { gap: 12, marginBottom: 20 },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  accountLabel: { color: colors.green, fontWeight: '700', fontSize: 15 },
  filterToggle: { minHeight: 44, justifyContent: 'center' },
  filters: { backgroundColor: colors.pale, borderRadius: 16, padding: 16, gap: 14 },
  count: { color: colors.muted, fontWeight: '600', marginTop: 8 },
  message: { gap: 12 },
  footer: { paddingVertical: 20, gap: 12 },
  empty: { paddingVertical: 20 },
});
