import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, usePreventRemove } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { privacyApi } from '../../application/services';
import { Action, Heading, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { BlockedAccounts } from './blocks';

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
        onRefresh={() => void controller.refresh()}
        ListHeaderComponent={
          <View style={styles.section}>
            <Heading
              title="Blocked accounts"
              detail="Only you can view this list. Unblocking allows communication when the other account's preferences and blocks also allow it."
            />
            {!!state.notice && <Notice>{state.notice}</Notice>}
            {!!state.error && <Notice error>{state.error}</Notice>}
            {state.loading && (
              <ActivityIndicator
                color={colors.green}
                accessibilityLabel="Loading blocked accounts"
              />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.display_name}</Text>
            <Notice>{item.role}</Notice>
            <Action
              label={`Unblock ${item.display_name}`}
              secondary
              busy={state.busy === item.id}
              disabled={!!state.busy || state.loading || state.more}
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
            />
          </View>
        )}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <Notice>You have no blocked accounts.</Notice>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.section}>
            <Action
              label="Refresh blocked accounts"
              secondary
              disabled={!!state.busy || state.loading || state.more}
              onPress={() => void controller.refresh()}
            />
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
  content: { padding: 20, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center' },
  section: { gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  name: { color: colors.ink, fontSize: 19, fontWeight: '700' },
});
