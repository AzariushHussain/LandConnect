import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
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

type Coordinate = { latitude: string; longitude: string };
export function LocationPicker({
  latitude,
  longitude,
  onConfirm,
  onCancel,
}: Coordinate & { onConfirm: (point: Coordinate) => void; onCancel: () => void }) {
  const initial = readCoordinate(latitude, longitude);
  const [point, setPoint] = useState<LngLat | null>(initial);
  const [target, setTarget] = useState(() => ({
    center: cameraCenter(initial ?? INDIA_CENTER),
    zoom: initial ? 15 : 4,
  }));
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const location = useDeviceLocation((value) => {
    const next = readCoordinate(value.latitude, value.longitude)!;
    setTarget({ center: cameraCenter(next), zoom: 16 });
    setPoint(next);
    setAccuracy(value.accuracy);
    setError('');
  });
  function pick(value: LngLat) {
    try {
      const selected = pickedCoordinate(value);
      location.cancel();
      setPoint(readCoordinate(selected.latitude, selected.longitude));
      setAccuracy(null);
      setError('');
    } catch {
      setError('Choose a valid location on the map.');
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.panel}>
          <Text style={styles.title}>Choose property location</Text>
          <Notice>
            Tap the map to place the property. Confirming updates the form; save or publish to store
            it.
          </Notice>
        </View>
        <LandMap center={target.center} zoom={target.zoom} pin={point} onPick={pick} />
        <ScrollView style={styles.controls} contentContainerStyle={styles.panel}>
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
          <Notice>
            Map tiles: OpenFreeMap. The provider receives the area you view. Device location is
            requested only when you tap below.
          </Notice>
          <Action
            label="Use my device location"
            secondary
            busy={location.busy}
            onPress={() => void location.locate()}
          />
          <Action
            label="Use selected location"
            disabled={!point}
            onPress={() => {
              if (point) {
                location.cancel();
                onConfirm(pickedCoordinate(point));
              }
            }}
          />
          <Action
            label="Cancel location selection"
            secondary
            onPress={() => {
              location.cancel();
              onCancel();
            }}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  panel: { padding: 16, gap: 8 },
  controls: { maxHeight: '55%', flexGrow: 0 },
  title: { fontSize: 21, fontWeight: '700', color: colors.ink },
});
