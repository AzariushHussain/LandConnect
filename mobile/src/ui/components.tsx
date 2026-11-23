import { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from './theme';

export function Screen({
  children,
  bottomInset = true,
}: {
  children: ReactNode;
  bottomInset?: boolean;
}) {
  return (
    <SafeAreaView
      style={styles.safe}
      edges={bottomInset ? ['left', 'right', 'bottom'] : ['left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.mark}>
        <Text style={styles.markText}>L</Text>
      </View>
      <View>
        <Text style={styles.brandName}>LandConnect</Text>
        <Text style={styles.caption}>GOOD LAND. REAL CONNECTIONS.</Text>
      </View>
    </View>
  );
}

export function Heading({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

export function Action({
  label,
  onPress,
  busy = false,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy || disabled, busy }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (busy || disabled || pressed) && { opacity: 0.65 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.green : '#FFFFFF'} />
      ) : (
        <Text style={[styles.buttonLabel, secondary && { color: colors.green }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <Text
      accessibilityRole={error ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.notice, error && { color: colors.error }]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 36,
    gap: 16,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  mark: {
    backgroundColor: colors.green,
    borderRadius: 15,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: 'white', fontWeight: '800', fontSize: 30 },
  brandName: { fontSize: 22, color: colors.ink, fontWeight: '700' },
  caption: { color: colors.muted, fontSize: 9, letterSpacing: 1.2, marginTop: 4 },
  heading: { gap: 10, marginVertical: 10 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700', color: colors.ink },
  detail: { fontSize: 16, lineHeight: 24, color: colors.muted },
  field: { gap: 8 },
  label: { fontWeight: '600', fontSize: 14, color: colors.ink },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.ink,
    fontSize: 16,
  },
  button: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  secondary: { backgroundColor: colors.pale },
  buttonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  notice: { color: colors.green, lineHeight: 22, fontSize: 14 },
});
