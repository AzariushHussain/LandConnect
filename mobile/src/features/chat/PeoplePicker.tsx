import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatApi } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { Inbox, people } from './inbox';
import { Person } from './types';

export function PeoplePicker({
  actor,
  excluded = [],
  selected,
  max,
  onDone,
  onCancel,
}: {
  actor: string;
  excluded?: string[];
  selected: Person[];
  max: number;
  onDone: (people: Person[]) => void;
  onCancel: () => void;
}) {
  const [inbox] = useState(() => new Inbox(chatApi));
  const state = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
  const [chosen, setChosen] = useState(selected);
  useEffect(() => {
    void inbox.refresh();
    return inbox.stop;
  }, [inbox]);
  const peers = people(state.items, actor).filter((person) => !excluded.includes(person.id));
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.panel}>
          <Text style={styles.title}>
            Choose people · {chosen.length}/{max}
          </Text>
          <Notice>
            People come from your existing conversations. Start a direct chat from a property
            listing to meet someone new.
          </Notice>
          {!!state.error && <Notice error>{state.error}</Notice>}
        </View>
        <FlatList
          data={peers}
          keyExtractor={(person) => person.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const checked = chosen.some((person) => person.id === item.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`${item.display_name}, ${item.role}`}
                accessibilityState={{ checked, disabled: !checked && chosen.length >= max }}
                disabled={!checked && chosen.length >= max}
                onPress={() =>
                  setChosen((current) =>
                    checked
                      ? current.filter((person) => person.id !== item.id)
                      : [...current, item],
                  )
                }
                style={styles.person}
              >
                <Text style={styles.name}>
                  {checked ? '✓ ' : ''}
                  {item.display_name}
                </Text>
                <Text style={styles.role}>{item.role}</Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            state.loading ? (
              <ActivityIndicator color={colors.green} />
            ) : (
              <Notice>No eligible people in these conversations yet.</Notice>
            )
          }
          ListFooterComponent={
            <View style={styles.panel}>
              {state.hasMore && (
                <Action
                  label="Load more people"
                  secondary
                  busy={state.more}
                  onPress={() => void inbox.more()}
                />
              )}
              {!!state.error && (
                <Action label="Retry people" secondary onPress={() => void inbox.refresh()} />
              )}
            </View>
          }
        />
        <View style={styles.panel}>
          <Action label="Use selected people" onPress={() => onDone(chosen)} />
          <Action label="Cancel choosing people" secondary onPress={onCancel} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  panel: { padding: 20, gap: 12 },
  list: { paddingHorizontal: 20, gap: 10 },
  person: { minHeight: 60, padding: 16, borderRadius: 12, backgroundColor: colors.pale, gap: 5 },
  title: { fontSize: 22, color: colors.ink, fontWeight: '700' },
  name: { fontSize: 17, color: colors.ink, fontWeight: '600' },
  role: { color: colors.muted },
});
