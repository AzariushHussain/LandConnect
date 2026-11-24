import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatApi } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { IconButton } from '../../ui/IconButton';
import { Inbox, people } from './inbox';
import { Person } from './types';
import { ChatAvatar } from './ChatAvatar';
import { ParticipantChips } from './ParticipantChips';
import { pickerPeople, toggleParticipant } from './participant-selection';

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
  const [chosen, setChosen] = useState(selected),
    [query, setQuery] = useState('');
  useEffect(() => {
    void inbox.refresh();
    return inbox.stop;
  }, [inbox]);
  const picked = chosen.filter((person) => person.id !== actor && !excluded.includes(person.id));
  const peers = pickerPeople(people(state.items, actor), picked, actor, excluded, query);
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <View style={styles.toolbar}>
              <IconButton
                icon="arrow-back"
                label="Cancel participant selection"
                onPress={onCancel}
              />
              <View style={styles.identity}>
                <Text style={styles.title} accessibilityRole="header">
                  {max === 1 ? 'Add a participant' : 'Select participants'}
                </Text>
                <Text style={styles.subtitle}>
                  {picked.length} of {max} selected
                </Text>
              </View>
            </View>
            <View style={styles.search}>
              <Ionicons name="search-outline" size={21} color={colors.muted} />
              <TextInput
                accessibilityLabel="Search participants by name"
                placeholder="Search by name"
                placeholderTextColor={colors.muted}
                value={query}
                onChangeText={setQuery}
                maxLength={80}
                autoCorrect={false}
                returnKeyType="search"
                style={styles.input}
              />
              {!!query && (
                <IconButton
                  icon="close"
                  label="Clear participant search"
                  size={40}
                  onPress={() => setQuery('')}
                />
              )}
            </View>
            <ParticipantChips
              people={picked}
              onRemove={(id) =>
                setChosen((current) => current.filter((person) => person.id !== id))
              }
            />
            <Text style={styles.hint}>
              From your conversations. To find someone new, use the search on Chats.
            </Text>
            {picked.length >= max && (
              <Text accessibilityLiveRegion="polite" style={styles.limit}>
                Selection limit reached. Remove someone to choose another person.
              </Text>
            )}
          </View>
          <FlatList
            data={peers}
            keyExtractor={(person) => person.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            refreshing={state.loading && state.items.length > 0}
            onRefresh={() => void inbox.refresh()}
            ListHeaderComponent={
              <Text style={styles.listHeading}>
                {query.trim() ? 'Matching people' : 'People from your chats'}
              </Text>
            }
            renderItem={({ item }) => {
              const checked = picked.some((person) => person.id === item.id);
              const disabled = !checked && picked.length >= max;
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${item.display_name}, ${item.role}`}
                  accessibilityState={{ checked, disabled }}
                  disabled={disabled}
                  onPress={() =>
                    setChosen((current) =>
                      toggleParticipant(
                        current.filter(
                          (person) => person.id !== actor && !excluded.includes(person.id),
                        ),
                        item,
                        max,
                      ),
                    )
                  }
                  style={({ pressed }) => [
                    styles.person,
                    checked && styles.personSelected,
                    { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 },
                  ]}
                >
                  <ChatAvatar name={item.display_name} size={48} />
                  <View style={styles.identity}>
                    <Text style={styles.name}>{item.display_name}</Text>
                    <Text style={styles.role}>{item.role}</Text>
                  </View>
                  <Ionicons
                    name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={26}
                    color={checked ? colors.green : colors.border}
                  />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              state.loading ? (
                <ActivityIndicator
                  color={colors.green}
                  accessibilityLabel="Loading participants"
                  style={styles.empty}
                />
              ) : (
                <View style={styles.empty}>
                  <Ionicons
                    name={query.trim() ? 'search-outline' : 'people-outline'}
                    size={38}
                    color={colors.muted}
                  />
                  <Text style={styles.emptyTitle}>
                    {query.trim() ? 'No matching people' : 'No available participants'}
                  </Text>
                  <Text style={styles.emptyText}>
                    {query.trim()
                      ? 'Try a different name, clear the search or load more conversations.'
                      : 'Start a conversation from Chats, then choose that person here. Current group members are already excluded.'}
                  </Text>
                </View>
              )
            }
            ListFooterComponent={
              <View style={styles.listFooter}>
                {!!state.error && (
                  <>
                    <Notice error>{state.error}</Notice>
                    <Action
                      label="Retry conversations"
                      secondary
                      onPress={() => void inbox.refresh()}
                    />
                  </>
                )}
                {state.hasMore && (
                  <Action
                    label="Load more conversations"
                    secondary
                    busy={state.more}
                    onPress={() => void inbox.more()}
                  />
                )}
              </View>
            }
          />
          <View style={styles.footer}>
            <Action
              label={max === 1 ? 'Continue' : `Use selection (${picked.length})`}
              disabled={max === 1 && !picked.length}
              onPress={() => onDone(picked)}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  title: { fontSize: 21, color: colors.ink, fontWeight: '600' },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 4 },
  identity: { flex: 1, gap: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.background,
  },
  input: { flex: 1, minHeight: 48, color: colors.ink, fontSize: 15 },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  limit: { fontSize: 12, color: colors.green, lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingBottom: 16, flexGrow: 1 },
  listHeading: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    paddingVertical: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
    minHeight: 76,
    borderRadius: 15,
    backgroundColor: colors.surface,
    marginBottom: 8,
  },
  personSelected: { backgroundColor: colors.pale },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  role: { fontSize: 12, color: colors.muted, textTransform: 'capitalize' },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 18, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  listFooter: { paddingVertical: 8, gap: 12 },
  footer: {
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
});
