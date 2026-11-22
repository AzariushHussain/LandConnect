import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { listingsApi } from '../../application/services';
import { Action, Heading, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ApiError } from '../../api/client';
import { formatDecimal } from './filters';
import { ListingPhoto } from './ListingPhoto';
import { Listing } from './types';
import { router } from 'expo-router';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; listing: Listing }
  | { status: 'error'; message: string; missing: boolean };

export function ListingDetailsScreen({ id }: { id: string }) {
  const [result, setResult] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    listingsApi.detail(id).then(
      (listing) => {
        if (active) setResult({ status: 'ready', listing });
      },
      (error: unknown) => {
        if (active)
          setResult({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load this property.',
            missing: error instanceof ApiError && error.status === 404,
          });
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);
  function reload() {
    setResult({ status: 'loading' });
    setAttempt(attempt + 1);
  }

  if (result.status === 'loading')
    return (
      <Screen>
        <ActivityIndicator
          size="large"
          color={colors.green}
          accessibilityLabel="Loading property details"
        />
      </Screen>
    );
  if (result.status === 'error')
    return (
      <Screen>
        <Heading
          title={result.missing ? 'Property unavailable.' : 'Could not load property.'}
          detail={result.message}
        />
        <Action label="Retry property" onPress={reload} />
      </Screen>
    );
  const { listing } = result;
  return (
    <Screen>
      <Heading
        title={listing.title}
        detail={`${listing.city}, ${listing.state}, ${listing.country}`}
      />
      <Action
        label="View location on map"
        secondary
        onPress={() =>
          router.push({
            pathname: '/map',
            params: { latitude: listing.latitude, longitude: listing.longitude },
          })
        }
      />
      {listing.images.length ? (
        <FlatList
          horizontal
          data={listing.images}
          keyExtractor={(photo) => photo.id}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
          renderItem={({ item, index }) => (
            <View style={styles.photo}>
              <ListingPhoto
                key={item.url}
                uri={listingsApi.photoUrl(item.url)}
                label={`${listing.title}, photo ${index + 1} of ${listing.images.length}`}
              />
              <Text style={styles.photoCount}>
                Photo {index + 1} of {listing.images.length}
              </Text>
            </View>
          )}
        />
      ) : (
        <ListingPhoto label={listing.title} />
      )}
      <View style={styles.card}>
        <Text style={styles.price}>
          {listing.currency} {formatDecimal(listing.price)}
        </Text>
        <Text style={styles.area}>{formatDecimal(listing.area_sq_m)} m² of land</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.section} accessibilityRole="header">
          About this property
        </Text>
        <Text style={styles.body}>{listing.description}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.section} accessibilityRole="header">
          Location
        </Text>
        <Text style={styles.body}>{listing.address}</Text>
        <Text style={styles.body}>
          {listing.city}, {listing.state}, {listing.country}
        </Text>
        <Text style={styles.muted}>
          Coordinates: {listing.latitude}, {listing.longitude}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.section} accessibilityRole="header">
          Listed by
        </Text>
        <Text style={styles.body}>{listing.owner.display_name}</Text>
        <Text style={styles.role}>{listing.owner.role}</Text>
        <Notice>Personal contact details stay private.</Notice>
      </View>
      <Action label="Refresh property" secondary onPress={reload} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { width: 290, gap: 8 },
  photoCount: { color: colors.muted, textAlign: 'center', fontSize: 13 },
  card: {
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  price: { fontSize: 26, fontWeight: '800', color: colors.green },
  area: { fontSize: 17, color: colors.ink, fontWeight: '600' },
  section: { fontSize: 19, fontWeight: '700', color: colors.ink },
  body: { fontSize: 16, lineHeight: 25, color: colors.ink },
  muted: { color: colors.muted, lineHeight: 22 },
  role: { textTransform: 'capitalize', color: colors.green, fontWeight: '600' },
});
