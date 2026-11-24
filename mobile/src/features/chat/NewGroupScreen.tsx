import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePreventRemove } from 'expo-router';
import { chatApi } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { PeoplePicker } from './PeoplePicker';
import { Person } from './types';
import { ChatAvatar } from './ChatAvatar';
import { ParticipantChips } from './ParticipantChips';

export function NewGroupScreen() {
  const session = useSession();
  const [name, setName] = useState(''),
    [selected, setSelected] = useState<Person[]>([]),
    [choosing, setChoosing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disable = usePreventRemove(
    !discard && (busy || !!name || selected.length > 0),
    ({ repeat }) => {
      if (locked.current) return;
      Alert.alert(
        'Leave group creation?',
        'Unsaved selections will be lost. If creation was not confirmed, check Chats before creating again.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => {
              setDiscard(true);
              repeat();
            },
          },
        ],
      );
    },
  );
  if (session.status !== 'signedIn') return null;
  async function create() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    try {
      const chat = await chatApi.group(
        name,
        selected.map((person) => person.id),
      );
      if (!mounted.current) return;
      setDiscard(true);
      disable();
      router.replace({ pathname: '/chats/[id]', params: { id: chat.id } });
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not create this group. Refresh Chats before retrying.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.hero}>
            <ChatAvatar name={name} group size={82} />
            <Text style={styles.preview} numberOfLines={2}>
              {name.trim() || 'Your new group'}
            </Text>
            <Text style={styles.subtitle}>Bring your property conversations together</Text>
          </View>
          <View style={styles.card}>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Group name</Text>
              <Text style={styles.count}>{Array.from(name).length}/100</Text>
            </View>
            <View style={styles.nameInput}>
              <Ionicons name="pencil-outline" size={20} color={colors.green} />
              <TextInput
                accessibilityLabel="Group name"
                placeholder="e.g. Pune property circle"
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  setError('');
                }}
                editable={!busy}
                maxLength={100}
                autoCapitalize="sentences"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                style={styles.input}
              />
            </View>
            <Text style={styles.hint}>Choose a name everyone will recognise.</Text>
          </View>
          <View style={styles.card}>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Participants</Text>
              <Text style={styles.count}>{selected.length + 1}/50</Text>
            </View>
            <View style={styles.owner}>
              <ChatAvatar name={session.user.display_name} size={42} />
              <View style={styles.identity}>
                <Text style={styles.personName}>You</Text>
                <Text style={styles.hint}>{session.user.display_name}</Text>
              </View>
              <Text style={styles.badge}>Owner</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selected.length ? 'Edit selected participants' : 'Add participants'
              }
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => {
                Keyboard.dismiss();
                setChoosing(true);
              }}
              style={({ pressed }) => [styles.addPeople, (pressed || busy) && { opacity: 0.55 }]}
            >
              <View style={styles.addIcon}>
                <Ionicons name="person-add-outline" size={23} color={colors.green} />
              </View>
              <View style={styles.identity}>
                <Text style={styles.addTitle}>
                  {selected.length ? 'Edit participants' : 'Add participants'}
                </Text>
                <Text style={styles.hint}>
                  {selected.length
                    ? `${selected.length} selected · tap to change`
                    : 'Choose up to 49 people from your chats'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.muted} />
            </Pressable>
            <ParticipantChips
              people={selected}
              disabled={busy}
              onRemove={(id) =>
                setSelected((current) => current.filter((person) => person.id !== id))
              }
            />
          </View>
          <View style={styles.info}>
            <Ionicons name="information-circle-outline" size={21} color={colors.muted} />
            <Text style={styles.infoText}>
              You will own this group. Participants, including people added later, can read its
              retained chat history.
            </Text>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          {!!error && <Notice error>{error}</Notice>}
          <Text style={styles.footerHint}>
            {!name.trim()
              ? 'Give your group a name to continue'
              : !selected.length
                ? 'Add at least one participant to continue'
                : `${selected.length + 1} participants, including you`}
          </Text>
          <Action
            label="Create group"
            busy={busy}
            disabled={!selected.length || !name.trim()}
            onPress={() => void create()}
          />
        </View>
      </KeyboardAvoidingView>
      {choosing && (
        <PeoplePicker
          actor={session.user.id}
          max={49}
          selected={selected}
          onCancel={() => setChoosing(false)}
          onDone={(people) => {
            setSelected(people);
            setError('');
            setChoosing(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: 20,
    gap: 18,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingBottom: 28,
  },
  hero: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  preview: { fontSize: 23, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  card: { padding: 18, borderRadius: 20, backgroundColor: colors.surface, gap: 14 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heading: { fontSize: 16, fontWeight: '600', color: colors.ink },
  count: { fontSize: 12, color: colors.muted },
  nameInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  input: { flex: 1, minHeight: 50, color: colors.ink, fontSize: 15 },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  identity: { flex: 1, gap: 3 },
  personName: { color: colors.ink, fontSize: 15, fontWeight: '500' },
  badge: {
    color: colors.green,
    backgroundColor: colors.pale,
    fontSize: 11,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
  addPeople: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 62 },
  addIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTitle: { color: colors.green, fontSize: 15, fontWeight: '600' },
  info: { flexDirection: 'row', gap: 9, paddingHorizontal: 4 },
  infoText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 19 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 9,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  footerHint: { textAlign: 'center', fontSize: 12, color: colors.muted },
});
