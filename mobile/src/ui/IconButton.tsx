import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'plain',
  busy = false,
  disabled = false,
  selected = false,
  caption,
  size = 46,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  tone?: 'plain' | 'soft' | 'dark' | 'danger' | 'success';
  busy?: boolean;
  disabled?: boolean;
  selected?: boolean;
  caption?: string;
  size?: number;
}) {
  const dark = tone === 'dark' || tone === 'danger' || tone === 'success';
  const foreground = selected ? colors.ink : dark ? '#FFFFFF' : colors.green;
  const background = selected
    ? '#FFFFFF'
    : {
        plain: 'transparent',
        soft: colors.pale,
        dark: '#314A40',
        danger: '#D74754',
        success: '#159C65',
      }[tone];
  return (
    <View style={[styles.wrap, { width: size }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy || disabled, busy, selected }}
        disabled={busy || disabled}
        onPress={onPress}
        hitSlop={4}
        style={({ pressed }) => [
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: background,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || busy || disabled ? 0.55 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={foreground} />
        ) : (
          <Ionicons name={icon} size={size >= 58 ? 28 : 23} color={foreground} />
        )}
      </Pressable>
      {!!caption && <Text style={[styles.caption, dark && { color: '#D9E8E0' }]}>{caption}</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  caption: { fontSize: 12, color: colors.muted, textAlign: 'center' },
});
