import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { listingsApi } from '../../application/services';
import { colors } from '../../ui/theme';
import { formatDecimal } from './filters';
import { ListingPhoto } from './ListingPhoto';
import { Listing } from './types';

export function ListingCard({ listing }: { listing: Listing }) {
  const photo = listing.images[0];
  const open = () => router.push({ pathname: '/listings/[id]', params: { id: listing.id } });
  return (
    <View style={styles.card}>
      <Pressable onPress={open} accessible={false} style={styles.cover}>
        <ListingPhoto
          key={photo?.url ?? listing.id}
          uri={photo ? listingsApi.photoUrl(photo.url) : undefined}
          label={`Land at ${listing.title}`}
          aspectRatio={1.65}
        />
        <View pointerEvents="none" style={styles.sale}>
          <Text style={styles.saleText}>For sale</Text>
        </View>
        {listing.images.length > 1 && (
          <View pointerEvents="none" style={styles.photos}>
            <Ionicons name="images-outline" color="#FFFFFF" size={14} />
            <Text style={styles.photosText}>{listing.images.length}</Text>
          </View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${listing.title}, ${listing.currency} ${formatDecimal(listing.price)}, ${listing.city}`}
        onPress={open}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.65 }]}
      >
        <Text style={styles.price}>
          {listing.currency} {formatDecimal(listing.price)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" color={colors.muted} size={15} />
          <Text style={styles.location} numberOfLines={1}>
            {listing.city}, {listing.state}
          </Text>
        </View>
        <View style={styles.bottom}>
          <View style={styles.area}>
            <Ionicons name="resize-outline" color={colors.green} size={16} />
            <Text style={styles.areaText}>{formatDecimal(listing.area_sq_m)} m²</Text>
          </View>
          <View style={styles.link}>
            <Text style={styles.linkText}>Details</Text>
            <Ionicons name="arrow-forward" color={colors.green} size={17} />
          </View>
        </View>
        <View style={styles.owner}>
          <Ionicons name="person-circle-outline" color={colors.muted} size={20} />
          <Text style={styles.ownerName} numberOfLines={1}>
            {listing.owner.display_name}
          </Text>
          <Text style={styles.role}>{listing.owner.role}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cover: { padding: 7, paddingBottom: 0 },
  sale: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#FFFFFFEE',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  saleText: { color: colors.green, fontSize: 11, fontWeight: '600' },
  photos: {
    position: 'absolute',
    bottom: 12,
    right: 20,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    backgroundColor: '#172E27B3',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  photosText: { color: '#FFFFFF', fontSize: 11 },
  body: { padding: 16, gap: 10 },
  price: { color: colors.green, fontSize: 23, fontWeight: '700' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '600', lineHeight: 25 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  location: { flex: 1, color: colors.muted, fontSize: 13 },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 4,
  },
  area: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.pale,
  },
  areaText: { color: colors.green, fontSize: 13, fontWeight: '500' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { color: colors.green, fontSize: 13, fontWeight: '500' },
  owner: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  ownerName: { flex: 1, color: colors.muted, fontSize: 12 },
  role: { color: colors.green, fontSize: 11, textTransform: 'capitalize' },
});
