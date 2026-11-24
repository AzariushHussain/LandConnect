import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect, usePreventRemove } from 'expo-router';
import { privacyApi } from '../../application/services';
import { Action, Heading, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { PrivacyPreferences } from './preferences';

export function PrivacyScreen() {
  const [controller] = useState(() => new PrivacyPreferences(privacyApi));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [discard, setDiscard] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!controller.dirty() && !controller.getSnapshot().uncertain) void controller.refresh();
    }, [controller]),
  );
  useEffect(() => controller.stop, [controller]);
  usePreventRemove(!discard && (controller.dirty() || state.saving), ({ repeat }) => {
    if (state.saving) {
      Alert.alert('Please wait', 'Wait for this save attempt to finish.');
      return;
    }
    Alert.alert(
      'Leave privacy settings?',
      'Unsaved changes will be lost. If saving was not confirmed, refresh settings when you return.',
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
  });
  function refresh() {
    if (controller.dirty() || state.uncertain)
      Alert.alert(
        'Refresh saved settings?',
        'Your current form will be replaced only after the saved settings load successfully.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Refresh', onPress: () => void controller.refresh() },
        ],
      );
    else void controller.refresh();
  }
  function save() {
    if (state.saved?.allow_calls && state.draft && !state.draft.allow_calls)
      Alert.alert(
        'Turn off incoming calls?',
        'This also ends active incoming direct calls and revokes incoming meeting invitations/access. Save these settings?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save settings', onPress: () => void controller.save() },
        ],
      );
    else void controller.save();
  }
  const disabled = state.loading || state.saving || state.uncertain;
  return (
    <Screen>
      <Heading
        title="Your privacy"
        detail="Control incoming direct communication and new invitations. Existing shared groups remain shared; leave a group to stop sharing its conversation."
      />
      {state.loading && (
        <ActivityIndicator
          color={colors.green}
          accessibilityLabel="Loading saved privacy settings"
        />
      )}
      {!!state.error && <Notice error>{state.error}</Notice>}
      {!!state.notice && <Notice>{state.notice}</Notice>}
      {state.draft && (
        <>
          <View style={styles.row}>
            <View style={styles.label}>
              <Text style={styles.title}>Direct messages and group invitations</Text>
              <Text style={styles.detail}>
                Turning this off prevents new incoming direct messages and group invitations. You
                can still send messages to people who allow them.
              </Text>
            </View>
            <Switch
              value={state.draft.allow_messages}
              disabled={disabled}
              onValueChange={(value) => controller.edit('allow_messages', value)}
              accessibilityLabel="Allow direct messages and group invitations"
              trackColor={{ true: colors.green, false: colors.border }}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.label}>
              <Text style={styles.title}>Incoming calls and meeting invitations</Text>
              <Text style={styles.detail}>
                Turning this off ends active incoming direct calls and revokes access to meetings
                hosted by other people.
              </Text>
            </View>
            <Switch
              value={state.draft.allow_calls}
              disabled={disabled}
              onValueChange={(value) => controller.edit('allow_calls', value)}
              accessibilityLabel="Allow incoming calls and meeting invitations"
              trackColor={{ true: colors.green, false: colors.border }}
            />
          </View>
          {controller.dirty() && <Notice>These changes are not saved yet.</Notice>}
          <Action
            label="Save privacy settings"
            busy={state.saving}
            disabled={disabled || !controller.dirty()}
            onPress={save}
          />
        </>
      )}
      <Action
        label="Refresh saved settings"
        secondary
        disabled={state.saving || state.loading}
        onPress={refresh}
      />
      <Action
        label="Blocked accounts"
        secondary
        disabled={state.saving}
        onPress={() => router.push('/privacy/blocked')}
      />
      <Notice>Review previously blocked accounts and unblock them here.</Notice>
    </Screen>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { flex: 1, gap: 8 },
  title: { fontWeight: '700', fontSize: 17, color: colors.ink },
  detail: { color: colors.muted, lineHeight: 22 },
});
