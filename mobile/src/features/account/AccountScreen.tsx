import { ComponentProps } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { session } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { canManage } from '../management/form';
import { ChatAvatar } from '../chat/ChatAvatar';

export function AccountScreen() {
  const state = useSession();
  if (state.status !== 'signedIn') return null;
  const { user } = state;
  return (
    <Screen bottomInset={false}>
      <View style={styles.profile}>
        <ChatAvatar name={user.display_name} size={88} />
        <Text style={styles.name} accessibilityRole="header">
          {user.display_name}
        </Text>
        <Text selectable style={styles.email}>
          {user.email}
        </Text>
        <View style={styles.badge}>
          <Text style={styles.role}>{user.role} account</Text>
        </View>
      </View>
      <Text style={styles.section} accessibilityRole="header">
        Your account
      </Text>
      <View style={styles.card}>
        {canManage(user.role) && (
          <AccountRow
            icon="business-outline"
            label="My properties"
            detail="Create and manage your listings"
            onPress={() => router.push('/manage')}
          />
        )}
        <AccountRow
          icon="ban-outline"
          label="Blocked contacts"
          detail="View and unblock contacts"
          onPress={() => router.push('/privacy/blocked')}
        />
      </View>
      <View style={styles.card}>
        <AccountRow
          icon="log-out-outline"
          label="Sign out"
          detail="Sign out of this device"
          danger
          onPress={() =>
            Alert.alert('Sign out?', 'You will need to sign in again on this device.', [
              { text: 'Stay signed in', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void session.signOut() },
            ])
          }
        />
      </View>
      <Text style={styles.brand}>LandConnect</Text>
    </Screen>
  );
}

function AccountRow({
  icon,
  label,
  detail,
  onPress,
  danger = false,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.pale }]}
    >
      <View style={[styles.icon, danger && { backgroundColor: '#FBEDED' }]}>
        <Ionicons name={icon} size={23} color={danger ? colors.error : colors.green} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, danger && { color: colors.error }]}>{label}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 30,
    paddingHorizontal: 22,
    borderRadius: 26,
    gap: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  name: { color: colors.ink, fontSize: 25, lineHeight: 33, fontWeight: '600', textAlign: 'center' },
  email: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  badge: {
    borderRadius: 20,
    backgroundColor: colors.pale,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  role: { color: colors.green, fontSize: 12, fontWeight: '500', textTransform: 'capitalize' },
  section: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginLeft: 4,
  },
  card: { backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    minHeight: 84,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 6 },
  label: { color: colors.ink, fontSize: 16, fontWeight: '500' },
  detail: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  brand: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
