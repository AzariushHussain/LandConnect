import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, usePreventRemove } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { privacyApi } from '../../application/services';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { BlockedAccounts } from './blocks';
import { ChatAvatar } from '../chat/ChatAvatar';

export function BlockedAccountsScreen() {
  const [controller] = useState(() => new BlockedAccounts(privacyApi));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      void controller.refresh();
    }, [controller]),
  );
  useEffect(() => controller.stop, [controller]);
  usePreventRemove(!!state.busy, () =>
    Alert.alert('Please wait', 'Wait for this unblock attempt to finish.'),
  );
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <FlatList
        data={state.items}
        keyExtractor={(peer) => peer.id}
        contentContainerStyle={styles.content}
        refreshing={state.loading}
        alwaysBounceVertical
        onRefresh={() => void controller.refresh()}
        ListHeaderComponent={
          <View style={styles.section}>
            <View style={styles.privacyNote}>
              <Ionicons name="shield-checkmark-outline" size={23} color={colors.green} />
              <View style={styles.identity}>
                <Text style={styles.noteTitle}>Only visible to you</Text>
                <Text style={styles.noteText}>
                  Other privacy settings and blocks still apply after unblocking. Pull down to
                  refresh.
                </Text>
              </View>
            </View>
            {!!state.notice && <Notice>{state.notice}</Notice>}
            {!!state.error && <Notice error>{state.error}</Notice>}
            {state.loading && !state.items.length && (
              <ActivityIndicator
                color={colors.green}
                accessibilityLabel="Loading blocked accounts"
              />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.contact}>
              <ChatAvatar name={item.display_name} size={50} />
              <View style={styles.identity}>
                <Text style={styles.name}>{item.display_name}</Text>
                <Text style={styles.role}>{item.role}</Text>
              </View>
              <View style={styles.status}>
                <Ionicons name="ban-outline" size={12} color={colors.error} />
                <Text style={styles.statusText}>Blocked</Text>
              </View>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.restriction}>Direct messages and calls blocked</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.display_name}`}
                accessibilityState={{
                  busy: state.busy === item.id,
                  disabled: !!state.busy || state.loading || state.more,
                }}
                disabled={!!state.busy || state.loading || state.more}
                style={({ pressed }) => [
                  styles.unblock,
                  (pressed || !!state.busy || state.loading || state.more) && { opacity: 0.55 },
                ]}
                onPress={() =>
                  Alert.alert(
                    `Unblock ${item.display_name}?`,
                    'Other privacy settings or a block set by this account can still prevent communication.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Unblock', onPress: () => void controller.unblock(item.id) },
                    ],
                  )
                }
              >
                {state.busy === item.id ? (
                  <ActivityIndicator size="small" color={colors.green} />
                ) : (
                  <Ionicons name="lock-open-outline" size={17} color={colors.green} />
                )}
                <Text style={styles.unblockText}>Unblock</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="shield-checkmark-outline" size={34} color={colors.green} />
              </View>
              <Text style={styles.emptyTitle}>No blocked contacts</Text>
              <Text style={styles.emptyText}>
                Contacts you block from an individual chat will appear here.
              </Text>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.section}>
            {!!state.error && (
              <Action
                label="Retry blocked contacts"
                secondary
                disabled={!!state.busy || state.loading || state.more}
                onPress={() => void controller.refresh()}
              />
            )}
            {state.hasMore && (
              <Action
                label="Load more blocked accounts"
                secondary
                busy={state.more}
                disabled={!!state.busy || state.loading}
                onPress={() => void controller.more()}
              />
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1 },
  section: { gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingBottom: 4 },
  identity: { flex: 1, gap: 5 },
  noteTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  noteText: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  role: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FBEDED',
  },
  statusText: { color: colors.error, fontSize: 10, fontWeight: '500' },
  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  restriction: { color: colors.muted, fontSize: 12, lineHeight: 18, flexGrow: 1, flexBasis: 120 },
  unblock: {
    minHeight: 44,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 13,
    backgroundColor: colors.pale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginLeft: 'auto',
  },
  unblockText: { color: colors.green, fontSize: 13, fontWeight: '600' },
  empty: { paddingVertical: 40, paddingHorizontal: 16, alignItems: 'center', gap: 12 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.ink, fontSize: 19, fontWeight: '600' },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 21, textAlign: 'center' },
});
