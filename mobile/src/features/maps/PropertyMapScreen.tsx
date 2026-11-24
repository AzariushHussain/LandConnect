import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listingsApi } from '../../application/services';
import { Action, Notice, Screen } from '../../ui/components';
import { IconButton } from '../../ui/IconButton';
import { colors } from '../../ui/theme';
import { Listing } from '../listings/types';
import { LandMap } from './LandMap';
import { LngLat, MERCATOR_LATITUDE } from './geo';

export function PropertyMapScreen({ id }: { id: string }) {
  const [listing, setListing] = useState<Listing | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [recenter, setRecenter] = useState(0);
  useEffect(() => {
    let active = true;
    listingsApi.detail(id).then(
      (value) => {
        if (active) {
          setListing(value);
          setError('');
        }
      },
      (failure) => {
        if (active) {
          setListing(null);
          setError(
            failure instanceof Error ? failure.message : 'Property location is unavailable.',
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);
  if (!listing)
    return (
      <Screen>
        {error ? (
          <>
            <Notice error>{error}</Notice>
            <Action
              label="Retry property location"
              onPress={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
            />
          </>
        ) : (
          <ActivityIndicator color={colors.green} accessibilityLabel="Loading property location" />
        )}
      </Screen>
    );
  const point: LngLat = [Number(listing.longitude), Number(listing.latitude)];
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.map}>
        <LandMap center={point} zoom={16} pin={point} recenter={recenter} />
        <View style={styles.recenter}>
          <IconButton
            icon="locate-outline"
            label="Center map on property"
            tone="soft"
            size={50}
            onPress={() => setRecenter((value) => value + 1)}
          />
        </View>
      </View>
      <View style={styles.details}>
        <Text style={styles.title}>{listing.title}</Text>
        <Text style={styles.address}>
          {listing.address}, {listing.city}, {listing.state}
        </Text>
        <Text style={styles.coordinates}>
          {listing.latitude}, {listing.longitude}
        </Text>
        {Math.abs(point[1]) > MERCATOR_LATITUDE && (
          <Notice>
            The map projection cannot display this polar location exactly. Use the coordinates
            above.
          </Notice>
        )}
        <Text style={styles.caption}>
          Map tiles by OpenFreeMap. The provider receives the area you view.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1 },
  recenter: { position: 'absolute', right: 16, top: 16 },
  details: { backgroundColor: colors.surface, padding: 20, gap: 8 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '600' },
  address: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  coordinates: { color: colors.green, fontSize: 12 },
  caption: { color: colors.muted, fontSize: 10, lineHeight: 16 },
});
