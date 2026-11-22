import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mapsApi } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { formatDecimal, ListingFilters } from '../listings/filters';
import { MapPoint } from './api';
import { Bounds, cameraCenter, INDIA_CENTER, LngLat, sameBounds } from './geo';
import { LandMap } from './LandMap';
import { MapSearch } from './search';
import { useDeviceLocation } from './use-device-location';

export function MapScreen({
  filters,
  initialCenter,
}: {
  filters: ListingFilters;
  initialCenter: LngLat | null;
}) {
  const [search] = useState(() => new MapSearch(mapsApi, filters));
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const [target, setTarget] = useState(() => ({
    center: cameraCenter(initialCenter ?? INDIA_CENTER),
    zoom: initialCenter ? 15 : 4,
  }));
  const [selected, setSelected] = useState<string>();
  const location = useDeviceLocation((point) =>
    setTarget({
      center: cameraCenter([Number(point.longitude), Number(point.latitude)]),
      zoom: 13,
    }),
  );
  useEffect(() => search.invalidate, [search]);
  const onViewport = useCallback(
    (bounds: Bounds) => {
      search.viewport(bounds);
      if (search.getSnapshot().status === 'idle') void search.search();
    },
    [search],
  );
  const previousArea = state.searched && !sameBounds(state.viewport, state.searched);
  const point = state.features.find((feature) => feature.id === selected);
  function details(feature: MapPoint) {
    router.push({ pathname: '/listings/[id]', params: { id: feature.id } });
  }
  const header = (
    <View>
      <View style={styles.toolbar}>
        <Notice>
          {Object.values(filters).some(Boolean)
            ? 'Community search filters apply. Go back to change them.'
            : 'Explore active properties. Pan or zoom, then search this area.'}
        </Notice>
        <Action
          label="Search this area"
          busy={state.status === 'loading' && !previousArea}
          disabled={!state.viewport}
          onPress={() => {
            setSelected(undefined);
            void search.search();
          }}
        />
      </View>
      <View style={styles.map}>
        <LandMap
          center={target.center}
          zoom={target.zoom}
          features={state.features}
          selected={selected}
          onSelect={setSelected}
          onViewport={onViewport}
          pin={initialCenter}
        />
      </View>
      <View style={styles.toolbar}>
        <Action
          label="Find properties near me"
          secondary
          busy={location.busy}
          onPress={() => void location.locate()}
        />
        {!!location.error && <Notice error>{location.error}</Notice>}
        <Text style={styles.caption}>
          Map tiles: OpenFreeMap. The provider receives the area you view. Device location is
          optional and requested only on tap.
        </Text>
        {initialCenter && <Notice>The red pin marks the property location you opened.</Notice>}
        {previousArea && (
          <Notice>
            Results belong to the previously searched area. Tap Search this area to update.
          </Notice>
        )}
        {state.status === 'ready' && (
          <Notice>
            Showing {state.features.length} of {state.total} matching properties in the searched
            area.
            {state.total > state.features.length
              ? ' Zoom in or narrow community filters to see more.'
              : ''}
          </Notice>
        )}
        {state.status === 'loading' && (
          <ActivityIndicator color={colors.green} accessibilityLabel="Searching map properties" />
        )}
        {!!state.error && <Notice error>{state.error}</Notice>}
        {point && (
          <View style={styles.selection}>
            <Text style={styles.title}>{point.properties.title}</Text>
            <Action label="Open selected property" secondary onPress={() => details(point)} />
          </View>
        )}
      </View>
    </View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <FlatList
        ListHeaderComponent={header}
        data={state.features}
        keyExtractor={(feature) => feature.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.properties.title}</Text>
            <Text style={styles.caption}>
              {item.properties.city} · {item.properties.currency}{' '}
              {formatDecimal(item.properties.price)} · {formatDecimal(item.properties.area_sq_m)} m²
            </Text>
            <Action
              label={`View ${item.properties.title}`}
              secondary
              onPress={() => details(item)}
            />
          </View>
        )}
        ListEmptyComponent={
          state.status === 'ready' ? (
            <Notice>
              No active properties match this area. Move the map or change your community filters.
            </Notice>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  toolbar: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  map: { height: 320 },
  list: { paddingBottom: 16, gap: 12 },
  card: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
  },
  title: { fontWeight: '700', fontSize: 17, color: colors.ink },
  caption: { color: colors.muted, lineHeight: 19 },
  selection: { gap: 8 },
});
