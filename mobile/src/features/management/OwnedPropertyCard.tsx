import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { listingsApi } from '../../application/services';
import { colors } from '../../ui/theme';
import { ListingPhoto } from '../listings/ListingPhoto';
import { ListingRecord } from '../listings/types';
import { formatDecimal } from '../listings/filters';

const statuses = {
  draft: {
    label: 'Draft',
    color: '#8A5B13',
    background: '#FFF0D6',
    detail: 'Only you can see this draft',
  },
  active: {
    label: 'Active',
    color: colors.green,
    background: colors.pale,
    detail: 'Visible in Listings',
  },
  sold: {
    label: 'Sold',
    color: '#315F8A',
    background: '#EAF2FB',
    detail: 'Hidden from public listings',
  },
  archived: {
    label: 'Archived',
    color: colors.muted,
    background: '#EDF0ED',
    detail: 'Hidden from public listings',
  },
};

export function OwnedPropertyCard({ listing, token }: { listing: ListingRecord; token: string }) {
  const status = statuses[listing.status],
    photo = listing.images[0];
  const edit = () => router.push({ pathname: '/manage/[id]', params: { id: listing.id } });
  return (
    <View style={styles.card}>
      <Pressable accessible={false} onPress={edit} style={styles.cover}>
        <ListingPhoto
          key={photo?.url ?? listing.id}
          uri={photo ? listingsApi.photoUrl(photo.url) : undefined}
          headers={{ Authorization: `Bearer ${token}` }}
          label={`${listing.title}, cover photo`}
          aspectRatio={1.8}
        />
        <View style={[styles.status, { backgroundColor: status.background }]} pointerEvents="none">
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
        {!!listing.images.length && (
          <View style={styles.photos} pointerEvents="none">
            <Ionicons name="images-outline" size={14} color="#FFFFFF" />
            <Text style={styles.photosText}>{listing.images.length}</Text>
          </View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${listing.title}, ${status.label}, ${listing.currency} ${formatDecimal(listing.price)}`}
        onPress={edit}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.65 }]}
      >
        <Text style={styles.price}>
          {listing.currency} {formatDecimal(listing.price)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>
        <View style={styles.location}>
          <Ionicons name="location-outline" size={16} color={colors.muted} />
          <Text style={styles.locationText} numberOfLines={1}>
            {listing.city}, {listing.state}
          </Text>
        </View>
        <View style={styles.facts}>
          <View style={styles.area}>
            <Ionicons name="resize-outline" color={colors.green} size={15} />
            <Text style={styles.areaText}>{formatDecimal(listing.area_sq_m)} m²</Text>
          </View>
          <Text style={styles.updated}>
            Updated{' '}
            {new Date(listing.updated_at).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </Text>
        </View>
        <View style={styles.editRow}>
          <Text style={styles.visibility}>{status.detail}</Text>
          <View style={styles.edit}>
            <Ionicons name="pencil-outline" color={colors.green} size={16} />
            <Text style={styles.editText}>Edit</Text>
          </View>
        </View>
      </Pressable>
      {listing.status === 'active' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View public listing: ${listing.title}`}
          onPress={() => router.push({ pathname: '/listings/[id]', params: { id: listing.id } })}
          style={({ pressed }) => [styles.preview, pressed && { opacity: 0.65 }]}
        >
          <Ionicons name="eye-outline" color={colors.green} size={18} />
          <Text style={styles.previewText}>View public listing</Text>
          <Ionicons name="arrow-forward" color={colors.green} size={17} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cover: { padding: 7, paddingBottom: 0 },
  status: {
    position: 'absolute',
    top: 19,
    left: 19,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  statusText: { fontSize: 11, fontWeight: '600' },
  photos: {
    position: 'absolute',
    right: 19,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    backgroundColor: '#172E27B3',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  photosText: { color: '#FFFFFF', fontSize: 11 },
  body: { padding: 16, gap: 11 },
  price: { color: colors.green, fontWeight: '700', fontSize: 23 },
  title: { color: colors.ink, fontWeight: '600', fontSize: 18, lineHeight: 25 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  locationText: { flex: 1, color: colors.muted, fontSize: 13 },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  area: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.pale,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  areaText: { color: colors.green, fontSize: 12, fontWeight: '500' },
  updated: { color: colors.muted, fontSize: 11 },
  editRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  visibility: { color: colors.muted, fontSize: 11, flex: 1, lineHeight: 17 },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  editText: { color: colors.green, fontWeight: '600', fontSize: 13 },
  preview: {
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF5EF',
  },
  previewText: { flex: 1, color: colors.green, fontSize: 13, fontWeight: '500' },
});
