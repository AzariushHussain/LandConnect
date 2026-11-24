import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../ui/theme';
import Ionicons from '@expo/vector-icons/Ionicons';

export function ListingPhoto({
  uri,
  label,
  headers,
  aspectRatio,
}: {
  uri?: string;
  label: string;
  headers?: Record<string, string>;
  aspectRatio?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(Boolean(uri));
  return (
    <View style={[styles.frame, aspectRatio ? { aspectRatio } : { height: 210 }]}>
      {!uri ? (
        <View style={styles.placeholder}>
          <Ionicons name="image-outline" size={32} color={colors.muted} />
          <Text style={styles.fallback}>No photos added yet</Text>
        </View>
      ) : failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry photo: ${label}`}
          style={styles.retry}
          onPress={(event) => {
            event.stopPropagation();
            setFailed(false);
            setLoading(true);
            setAttempt(attempt + 1);
          }}
        >
          <Text style={styles.fallback}>Photo unavailable</Text>
          <Text style={styles.retryText}>Tap to retry</Text>
        </Pressable>
      ) : (
        <Image
          key={`${uri}:${attempt}`}
          source={{ uri, headers }}
          resizeMode="cover"
          accessibilityLabel={label}
          style={styles.image}
          onError={() => {
            setFailed(true);
            setLoading(false);
          }}
          onLoadEnd={() => setLoading(false)}
        />
      )}
      {!!uri && !failed && loading && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ActivityIndicator
            accessibilityLabel="Loading property photo"
            color={colors.green}
            style={styles.loading}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  frame: {
    width: '100%',
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 16,
  },
  image: { height: '100%', width: '100%' },
  retry: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 8 },
  fallback: { color: colors.muted, fontSize: 15 },
  placeholder: { alignItems: 'center', gap: 10 },
  retryText: { color: colors.green, fontWeight: '600' },
});
