import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { listingsApi } from '../../application/services';
import { Action, Heading, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ApiError } from '../../api/client';
import { formatDecimal } from './filters';
import { ListingPhoto } from './ListingPhoto';
import { Listing } from './types';
import { MessageOwner } from '../chat/MessageOwner';
import { CallButtons } from '../calls/CallButtons';
import { ChatAvatar } from '../chat/ChatAvatar';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; listing: Listing }
  | { status: 'error'; message: string; missing: boolean };

export function ListingDetailsScreen({ id }: { id: string }) {
  const [result, setResult] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0),
    [refreshing, setRefreshing] = useState(false),
    [galleryWidth, setGalleryWidth] = useState(280);
  useEffect(() => {
    let active = true;
    listingsApi.detail(id).then(
      (listing) => {
        if (active) {
          setResult({ status: 'ready', listing });
          setRefreshing(false);
        }
      },
      (error: unknown) => {
        if (active) {
          setResult({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load this property.',
            missing: error instanceof ApiError && error.status === 404,
          });
          setRefreshing(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);
  function reload() {
    if (refreshing) return;
    setRefreshing(true);
    setAttempt((current) => current + 1);
  }
  if (result.status === 'loading')
    return (
      <Screen refreshing={refreshing} onRefresh={reload}>
        <ActivityIndicator
          size="large"
          color={colors.green}
          accessibilityLabel="Loading property details"
        />
      </Screen>
    );
  if (result.status === 'error')
    return (
      <Screen refreshing={refreshing} onRefresh={reload}>
        <Heading
          title={result.missing ? 'Property unavailable.' : 'Could not load property.'}
          detail={result.message}
        />
        <Action label="Retry property" busy={refreshing} onPress={reload} />
      </Screen>
    );
  const { listing } = result;
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <View
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          if (next > 0) setGalleryWidth(next);
        }}
      >
        {listing.images.length ? (
          <FlatList
            horizontal
            data={listing.images}
            keyExtractor={(photo) => photo.id}
            showsHorizontalScrollIndicator={false}
            snapToInterval={galleryWidth + 12}
            decelerationRate="fast"
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            renderItem={({ item, index }) => (
              <View style={{ width: galleryWidth }}>
                <ListingPhoto
                  key={item.url}
                  uri={listingsApi.photoUrl(item.url)}
                  label={`${listing.title}, photo ${index + 1} of ${listing.images.length}`}
                  aspectRatio={1.4}
                />
                <View pointerEvents="none" style={styles.photoCount}>
                  <Ionicons name="images-outline" color="#FFFFFF" size={14} />
                  <Text style={styles.photoCountText}>
                    {index + 1} / {listing.images.length}
                  </Text>
                </View>
              </View>
            )}
          />
        ) : (
          <ListingPhoto label={listing.title} aspectRatio={1.4} />
        )}
      </View>
      <View style={styles.card}>
        <View style={styles.summaryTop}>
          <Text style={styles.sale}>FOR SALE</Text>
          <Text style={styles.muted}>
            Updated {new Date(listing.updated_at).toLocaleDateString()}
          </Text>
        </View>
        <Text style={styles.price}>
          {listing.currency} {formatDecimal(listing.price)}
        </Text>
        <Text style={styles.title} accessibilityRole="header">
          {listing.title}
        </Text>
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={17} color={colors.muted} />
          <Text style={styles.locationText}>
            {listing.city}, {listing.state}, {listing.country}
          </Text>
        </View>
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Ionicons name="resize-outline" color={colors.green} size={22} />
            <View style={styles.factCopy}>
              <Text style={styles.factLabel}>Land area</Text>
              <Text style={styles.factValue}>{formatDecimal(listing.area_sq_m)} m²</Text>
            </View>
          </View>
          <View style={styles.fact}>
            <Ionicons name="person-outline" color={colors.green} size={22} />
            <View style={styles.factCopy}>
              <Text style={styles.factLabel}>Listed by</Text>
              <Text style={styles.factValue}>{listing.owner.role}</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.section} accessibilityRole="header">
          About this land
        </Text>
        <Text style={styles.body} selectable>
          {listing.description}
        </Text>
      </View>
      <View style={styles.card}>
        <View style={styles.sectionRow}>
          <Ionicons name="location-outline" color={colors.green} size={22} />
          <Text style={styles.section} accessibilityRole="header">
            Location
          </Text>
        </View>
        <Text style={styles.body}>{listing.address}</Text>
        <Text style={styles.locationText}>
          {listing.city}, {listing.state}, {listing.country}
        </Text>
        <Text style={styles.muted}>
          Coordinates: {listing.latitude}, {listing.longitude}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View location on map"
          style={styles.mapLink}
          onPress={() =>
            router.push({
              pathname: '/property-map/[id]',
              params: { id: listing.id },
            })
          }
        >
          <Ionicons name="map-outline" color={colors.green} size={20} />
          <Text style={styles.mapText}>View on map</Text>
          <Ionicons name="arrow-forward" color={colors.green} size={18} />
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.section} accessibilityRole="header">
          Listed by
        </Text>
        <View style={styles.ownerRow}>
          <ChatAvatar name={listing.owner.display_name} size={52} />
          <View style={styles.ownerCopy}>
            <Text style={styles.ownerName}>{listing.owner.display_name}</Text>
            <Text style={styles.role}>{listing.owner.role}</Text>
          </View>
          <CallButtons peerId={listing.owner.id} compact />
        </View>
        <Text style={styles.muted}>
          Chat or call through LandConnect. Personal contact details stay private.
        </Text>
        <MessageOwner ownerId={listing.owner.id} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoCount: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#172E27B3',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  photoCountText: { color: '#FFFFFF', fontSize: 12 },
  card: {
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: 22,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sale: {
    color: colors.green,
    backgroundColor: colors.pale,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.7,
  },
  price: { fontSize: 28, fontWeight: '700', color: colors.green },
  title: { fontSize: 23, lineHeight: 30, fontWeight: '600', color: colors.ink },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationText: { color: colors.muted, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 16,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 9, flexGrow: 1, flexBasis: 130 },
  factCopy: { gap: 4, flex: 1 },
  factLabel: { fontSize: 11, color: colors.muted },
  factValue: { fontSize: 14, color: colors.ink, fontWeight: '600', textTransform: 'capitalize' },
  section: { fontSize: 18, fontWeight: '600', color: colors.ink },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { fontSize: 15, lineHeight: 24, color: colors.ink },
  muted: { color: colors.muted, lineHeight: 18, fontSize: 11 },
  mapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.pale,
  },
  mapText: { flex: 1, color: colors.green, fontSize: 14, fontWeight: '500' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  ownerCopy: { flex: 1, gap: 6, minWidth: 80 },
  ownerName: { fontSize: 16, color: colors.ink, fontWeight: '600' },
  role: { textTransform: 'capitalize', color: colors.green, fontSize: 12 },
});
