import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { listingsApi } from '../../application/services';
import { colors } from '../../ui/theme';
import { formatDecimal } from './filters';
import { ListingPhoto } from './ListingPhoto';
import { Listing } from './types';

export function ListingCard({ listing }: { listing: Listing }) {
  const photo = listing.images[0];
  return (
    <View style={styles.card}>
      <ListingPhoto
        key={photo?.url ?? listing.id}
        uri={photo ? listingsApi.photoUrl(photo.url) : undefined}
        label={`Land at ${listing.title}`}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${listing.title}, ${listing.currency} ${formatDecimal(listing.price)}, ${listing.city}`}
        onPress={() => router.push({ pathname: '/listings/[id]', params: { id: listing.id } })}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.65 }]}
      >
        <Text style={styles.price}>
          {listing.currency} {formatDecimal(listing.price)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>
        <Text style={styles.location}>
          {listing.city}, {listing.state}
        </Text>
        <View style={styles.bottom}>
          <Text style={styles.area}>{formatDecimal(listing.area_sq_m)} m²</Text>
          <Text style={styles.link}>View property →</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
  },
  body: { padding: 12, gap: 10, minHeight: 160 },
  price: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 19, fontWeight: '700', lineHeight: 25 },
  location: { color: colors.muted, fontSize: 15 },
  bottom: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 5,
  },
  area: { color: colors.ink, fontWeight: '600' },
  link: { color: colors.green, fontWeight: '700' },
});
