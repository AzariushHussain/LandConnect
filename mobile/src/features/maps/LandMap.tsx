import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { validateMapStyle } from '../../config/map-style';
import { MapPoint } from './api';
import { Bounds, cameraCenter, LngLat, nativeBounds } from './geo';

type Props = {
  center: LngLat;
  zoom: number;
  features?: MapPoint[];
  selected?: string;
  pin?: LngLat | null;
  onSelect?: (id: string) => void;
  onPick?: (point: LngLat) => void;
  onViewport?: (bounds: Bounds) => void;
};
export function LandMap(props: Props) {
  const [attempt, setAttempt] = useState(0);
  let style: string;
  try {
    style = validateMapStyle(process.env.EXPO_PUBLIC_MAP_STYLE_URL);
  } catch {
    return (
      <View style={styles.fallback}>
        <Notice error>
          Map configuration is invalid. You can still use the property list or enter coordinates
          manually.
        </Notice>
      </View>
    );
  }
  return (
    <MapSurface key={attempt} {...props} mapStyle={style} retry={() => setAttempt(attempt + 1)} />
  );
}
function MapSurface({
  center,
  zoom,
  features = [],
  selected,
  pin,
  onSelect,
  onPick,
  onViewport,
  mapStyle,
  retry,
}: Props & { mapStyle: string; retry: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [areaError, setAreaError] = useState('');
  const target = useMemo(() => cameraCenter(center), [center]);
  const initialView = useMemo(() => ({ center: target, zoom }), [target, zoom]);
  const data = useMemo(() => ({ type: 'FeatureCollection' as const, features }), [features]);
  useEffect(() => {
    if (status !== 'loading') return;
    const timeout = setTimeout(() => setStatus('error'), 20000);
    return () => clearTimeout(timeout);
  }, [status]);
  return (
    <View style={styles.container}>
      <Map
        mapStyle={mapStyle}
        androidView="texture"
        attribution
        compass
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingStyle={() => setStatus('ready')}
        onDidFailLoadingMap={() => setStatus('error')}
        onRegionDidChange={(event) => {
          if (!onViewport) return;
          try {
            onViewport(nativeBounds(event.nativeEvent.bounds));
            setAreaError('');
          } catch {
            setAreaError('Could not read the map area. Move the map and try again.');
          }
        }}
        onPress={(event) => onPick?.(event.nativeEvent.lngLat)}
      >
        <Camera
          initialViewState={initialView}
          center={target}
          zoom={zoom}
          maxZoom={20}
          duration={250}
        />
        <GeoJSONSource
          id="properties"
          data={data}
          onPress={(event) => {
            event.stopPropagation();
            const id = event.nativeEvent.features[0]?.id;
            if (typeof id === 'string' && features.some((point) => point.id === id)) onSelect?.(id);
          }}
        >
          <Layer
            id="property-points"
            type="circle"
            paint={{
              'circle-radius': ['case', ['==', ['id'], selected ?? ''], 11, 8],
              'circle-color': colors.green,
              'circle-stroke-color': '#FFFFFF',
              'circle-stroke-width': 3,
            }}
          />
        </GeoJSONSource>
        {pin && (
          <GeoJSONSource
            id="chosen-location"
            data={{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: pin },
              properties: {},
            }}
          >
            <Layer
              id="chosen-point"
              type="circle"
              paint={{
                'circle-radius': 10,
                'circle-color': '#D64D3E',
                'circle-stroke-color': '#FFFFFF',
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>
      {status === 'loading' && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.green} accessibilityLabel="Loading map" />
        </View>
      )}
      {status === 'error' && (
        <View style={styles.fallback}>
          <Notice error>
            Map tiles could not be loaded. Check your connection. Coordinates and property lists
            remain available.
          </Notice>
          <Action label="Retry map" secondary onPress={retry} />
        </View>
      )}
      {!!areaError && (
        <View style={styles.areaError}>
          <Notice error>{areaError}</Notice>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 180, backgroundColor: colors.pale },
  loading: {
    position: 'absolute',
    top: 14,
    right: 14,
    padding: 10,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  fallback: { padding: 18, gap: 12, backgroundColor: colors.surface },
  areaError: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    padding: 8,
  },
});
