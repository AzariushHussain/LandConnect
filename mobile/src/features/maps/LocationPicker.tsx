import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import {
  cameraCenter,
  INDIA_CENTER,
  LngLat,
  MERCATOR_LATITUDE,
  pickedCoordinate,
  readCoordinate,
} from './geo';
import { LandMap } from './LandMap';
import { useDeviceLocation } from './use-device-location';
import { managementApi } from '../../application/services';
import { Place, PlaceSearch } from './place-search';
import { IconButton } from '../../ui/IconButton';
import { AddressLookup, Coordinate, SelectedLocation } from './address-lookup';

export function LocationPicker({
  latitude,
  longitude,
  onConfirm,
  onCancel,
}: Coordinate & { onConfirm: (value: SelectedLocation) => void; onCancel: () => void }) {
  const initial = readCoordinate(latitude, longitude);
  const [point, setPoint] = useState<LngLat | null>(initial);
  const [search] = useState(() => new PlaceSearch((query) => managementApi.searchPlaces(query)));
  const results = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const [address] = useState(
    () => new AddressLookup((point) => managementApi.reverseLocation(point)),
  );
  const resolving = useSyncExternalStore(address.subscribe, address.getSnapshot);
  const [chosenPlace, setChosenPlace] = useState('');
  const [target, setTarget] = useState(() => ({
    center: cameraCenter(initial ?? INDIA_CENTER),
    zoom: initial ? 15 : 4,
    recenter: 0,
  }));
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const location = useDeviceLocation((value) => {
    const next = readCoordinate(value.latitude, value.longitude)!;
    search.dismiss();
    address.cancel();
    setChosenPlace('');
    setTarget((previous) => ({
      center: cameraCenter(next),
      zoom: 16,
      recenter: previous.recenter + 1,
    }));
    setPoint(next);
    setAccuracy(value.accuracy);
    setError('');
  });
  useEffect(
    () => () => {
      search.dismiss();
      address.cancel();
    },
    [search, address],
  );
  function pick(value: LngLat) {
    try {
      const selected = pickedCoordinate(value);
      location.cancel();
      search.dismiss();
      address.cancel();
      setChosenPlace('');
      setPoint(readCoordinate(selected.latitude, selected.longitude));
      setAccuracy(null);
      setError('');
    } catch {
      setError('Choose a valid location on the map.');
    }
  }
  function choose(place: Place) {
    Keyboard.dismiss();
    const next: LngLat = [place.longitude, place.latitude];
    pick(next);
    setChosenPlace(place.label);
    setTarget((previous) => ({
      center: cameraCenter(next),
      zoom: 16,
      recenter: previous.recenter + 1,
    }));
  }
  function submit() {
    Keyboard.dismiss();
    location.cancel();
    address.cancel();
    void search.search();
  }
  function close() {
    location.cancel();
    search.dismiss();
    address.cancel();
    onCancel();
  }
  async function confirmPoint() {
    if (!point) return;
    location.cancel();
    search.dismiss();
    Keyboard.dismiss();
    const selected = await address.resolve(point);
    if (selected) onConfirm(selected);
  }
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.panel}>
          <Text style={styles.title}>Choose property location</Text>
          <Notice>
            Search for a place or tap the map to mark the property. You can adjust the point before
            confirming. Available address details will prefill the form.
          </Notice>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={21} color={colors.muted} />
            <TextInput
              accessibilityLabel="Search place or address"
              placeholder="Search city, area or address"
              placeholderTextColor={colors.muted}
              value={results.query}
              onChangeText={(value) => {
                address.cancel();
                search.setQuery(value);
              }}
              maxLength={200}
              returnKeyType="search"
              autoCorrect={false}
              onSubmitEditing={submit}
              style={styles.searchInput}
            />
            {!!results.query && (
              <IconButton
                icon="close"
                label="Clear place search"
                size={40}
                onPress={() => search.setQuery('')}
              />
            )}
          </View>
          <Action
            label={results.busy ? 'Searching places' : 'Search places'}
            busy={results.busy}
            disabled={Array.from(results.query.trim()).length < 3}
            onPress={submit}
          />
          {!!results.error && <Notice error>{results.error}</Notice>}
          {results.searched && results.items.length === 0 && (
            <Notice>No places found. Try adding the city or mark a point on the map.</Notice>
          )}
        </View>
        <View style={styles.mapArea}>
          <LandMap
            center={target.center}
            zoom={target.zoom}
            recenter={target.recenter}
            pin={point}
            onPick={pick}
          />
          {!!results.items.length && (
            <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
              {results.items.map((place) => (
                <Pressable
                  key={place.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${place.label}`}
                  onPress={() => choose(place)}
                  style={({ pressed }) => [styles.result, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="location-outline" size={23} color={colors.green} />
                  <View style={styles.resultBody}>
                    <Text style={styles.resultName}>{place.name}</Text>
                    <Text style={styles.resultLabel} numberOfLines={2}>
                      {place.label}
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward-outline" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
        <ScrollView style={styles.controls} contentContainerStyle={styles.panel}>
          {!!chosenPlace && <Text style={styles.resultName}>{chosenPlace}</Text>}
          {point ? (
            <Notice>
              Latitude {point[1].toFixed(6)} · Longitude {point[0].toFixed(6)}
            </Notice>
          ) : (
            <Notice>No location selected yet.</Notice>
          )}
          {point && Math.abs(point[1]) > MERCATOR_LATITUDE && (
            <Notice>
              The map projection cannot show this polar location. You can keep its coordinates or
              choose another point.
            </Notice>
          )}
          {accuracy !== null && (
            <Notice>
              Device estimate: approximately ±{accuracy} m. Check the property location before
              confirming.
            </Notice>
          )}
          {!!(error || location.error) && <Notice error>{error || location.error}</Notice>}
          {resolving.busy && <Notice>Finding address details for the selected point…</Notice>}
          {!!resolving.error && (
            <Notice error>
              {resolving.error} Retry or use coordinates only and enter the address manually.
            </Notice>
          )}
          <Notice>
            Map: OpenFreeMap. Search and address lookup: Photon. Search text and confirmed
            coordinates are shared with the provider. Device location is requested only when you tap
            below.
          </Notice>
          <Text
            accessibilityRole="link"
            onPress={() =>
              void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() =>
                setError('Could not open attribution.'),
              )
            }
            style={styles.credit}
          >
            © OpenStreetMap contributors
          </Text>
          <Action
            label="Use my device location"
            secondary
            busy={location.busy}
            onPress={() => {
              search.dismiss();
              address.cancel();
              Keyboard.dismiss();
              void location.locate();
            }}
          />
          <Action
            label="Use selected location"
            busy={resolving.busy}
            disabled={!point}
            onPress={() => void confirmPoint()}
          />
          {resolving.error && point && (
            <Action
              label="Use coordinates only"
              secondary
              onPress={() => {
                location.cancel();
                search.dismiss();
                address.cancel();
                onConfirm({ point: pickedCoordinate(point), address: null });
              }}
            />
          )}
          <Action label="Cancel location selection" secondary onPress={close} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  panel: { padding: 16, gap: 8 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
  },
  searchInput: { flex: 1, minHeight: 48, fontSize: 15, color: colors.ink },
  mapArea: { flex: 1, minHeight: 180 },
  results: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    maxHeight: 180,
    backgroundColor: colors.surface,
    borderRadius: 14,
    elevation: 6,
    zIndex: 1,
  },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 64 },
  resultBody: { flex: 1, gap: 3 },
  resultName: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  resultLabel: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  credit: { color: colors.green, fontSize: 12, paddingVertical: 5 },
  controls: { maxHeight: '40%', flexGrow: 0 },
  title: { fontSize: 21, fontWeight: '700', color: colors.ink },
});
