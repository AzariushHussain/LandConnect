import { Alert, StyleSheet, Text, View } from 'react-native';
import { useCallback, useState } from 'react';
import { privacyApi, session } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Brand, Heading, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { router, useFocusEffect } from 'expo-router';
import { canManage } from '../management/form';

export function AccountScreen() {
  const state = useSession();
  const [privacyError, setPrivacyError] = useState('');
  useFocusEffect(
    useCallback(() => {
      let active = true;
      privacyApi.current().then(
        () => {
          if (active) setPrivacyError('');
        },
        () => {
          if (active)
            setPrivacyError(
              'Could not refresh privacy preferences. The values shown were last confirmed on this device.',
            );
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );
  if (state.status !== 'signedIn') return null;
  const { user } = state;
  return (
    <Screen bottomInset={false}>
      <Brand />
      <Heading
        title={`Hello, ${user.display_name}.`}
        detail="Welcome to your LandConnect account."
      />
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.initial}>{user.display_name[0]?.toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{user.display_name}</Text>
        <Text style={styles.email}>{user.email}</Text>
        <View style={styles.badge}>
          <Text style={styles.role}>{user.role}</Text>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.section} accessibilityRole="header">
          Your privacy
        </Text>
        <Text style={styles.row}>Messages: {user.allow_messages ? 'Allowed' : 'Off'}</Text>
        <Text style={styles.row}>Incoming calls: {user.allow_calls ? 'Allowed' : 'Off'}</Text>
        <Text style={styles.note}>Last confirmed account preferences.</Text>
        {!!privacyError && <Notice error>{privacyError}</Notice>}
        <Action label="Privacy settings" secondary onPress={() => router.push('/privacy')} />
      </View>
      <Action label="Call controls" secondary onPress={() => router.navigate('/calls')} />
      <Action label="Meetings" secondary onPress={() => router.push('/meetings')} />
      <Action
        secondary
        label="Sign out of this device"
        onPress={() =>
          Alert.alert('Sign out?', 'You will need to sign in again on this device.', [
            { text: 'Stay signed in', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void session.signOut() },
          ])
        }
      />
      {canManage(user.role) && (
        <Action label="My properties" onPress={() => router.push('/manage')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    backgroundColor: colors.surface,
    padding: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: colors.green, fontSize: 28, fontWeight: '700' },
  name: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  email: { color: colors.muted, fontSize: 16 },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.pale,
  },
  role: { textTransform: 'capitalize', color: colors.green, fontWeight: '600' },
  section: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  row: { color: colors.ink, fontSize: 16 },
  note: { color: colors.muted, lineHeight: 22 },
});
