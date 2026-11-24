import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../../ui/theme';
import { ChatAvatar } from './ChatAvatar';
import { Person } from './types';

export function ParticipantChips({
  people,
  onRemove,
  disabled = false,
}: {
  people: Person[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  if (!people.length) return null;
  return (
    <ScrollView
      horizontal
      style={styles.scroll}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
    >
      {people.map((person) => (
        <Pressable
          key={person.id}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${person.display_name} from selection`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onRemove(person.id)}
          style={({ pressed }) => [styles.chip, { opacity: pressed || disabled ? 0.55 : 1 }]}
        >
          <ChatAvatar name={person.display_name} size={30} />
          <Text style={styles.name} numberOfLines={1}>
            {person.display_name}
          </Text>
          <Ionicons name="close-circle" size={19} color={colors.muted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  scroll: { flexGrow: 0, height: 54 },
  list: { gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 46,
    borderRadius: 24,
    paddingLeft: 6,
    paddingRight: 10,
    backgroundColor: colors.pale,
  },
  name: { maxWidth: 125, color: colors.ink, fontSize: 13, fontWeight: '500' },
});
