import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../ui/theme';

export function GroupActionRow({
  icon,
  label,
  detail,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const tint = danger ? colors.error : colors.green;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}
    >
      <View style={[styles.icon, danger && { backgroundColor: '#FBEDED' }]}>
        <Ionicons name={icon} size={22} color={tint} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, danger && { color: tint }]}>{label}</Text>
        {!!detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.muted} />
    </Pressable>
  );
}

export function GroupActionSheet({
  title,
  visible,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close action card"
          disabled={busy}
          onPress={onClose}
        />
        <SafeAreaView
          edges={['bottom', 'left', 'right']}
          style={styles.sheet}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close action card"
              disabled={busy}
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" color={colors.muted} size={24} />
            </Pressable>
          </View>
          <ScrollView
            style={{ flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 13 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 4 },
  label: { fontSize: 16, fontWeight: '500', color: colors.ink },
  detail: { fontSize: 12, lineHeight: 17, color: colors.muted },
  overlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  heading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  title: { flex: 1, fontSize: 20, fontWeight: '600', color: colors.ink },
  close: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 12, paddingBottom: 18, gap: 6 },
});
