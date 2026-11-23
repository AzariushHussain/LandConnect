import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../ui/theme';

export function ChatAvatar({
  name,
  group = false,
  size = 56,
  dark = false,
}: {
  name: string;
  group?: boolean;
  size?: number;
  dark?: boolean;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
  return (
    <View
      accessible={false}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        dark && { backgroundColor: '#234A3B' },
      ]}
    >
      {group ? (
        <Ionicons name="people" size={size * 0.45} color={dark ? '#D9E8E0' : colors.green} />
      ) : (
        <Text
          style={{
            color: dark ? '#D9E8E0' : colors.green,
            fontSize: size * 0.35,
            fontWeight: '600',
          }}
        >
          {initials || '?'}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale },
});
