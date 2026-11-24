import { ComponentProps, Ref, useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputInstance, TextInputProps, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { IconButton } from '../../ui/IconButton';
import { colors } from '../../ui/theme';
import { Notice } from '../../ui/components';

export function AuthField({
  label,
  icon,
  error,
  hint,
  inputRef,
  visible,
  onVisibility,
  ...props
}: TextInputProps & {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  error?: string;
  hint?: string;
  inputRef?: Ref<TextInputInstance>;
  visible?: boolean;
  onVisibility?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, focused && styles.focused, !!error && styles.invalid]}>
        <Ionicons name={icon} size={20} color={error ? colors.error : colors.muted} />
        <TextInput
          submitBehavior="submit"
          {...props}
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.muted}
          style={styles.input}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
        />
        {onVisibility && (
          <IconButton
            icon={visible ? 'eye-off-outline' : 'eye-outline'}
            label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            disabled={props.editable === false}
            size={44}
            onPress={onVisibility}
          />
        )}
      </View>
      {error ? (
        <Notice error>{error}</Notice>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 5,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FBFCFA',
  },
  focused: { borderColor: colors.green, backgroundColor: colors.surface },
  invalid: { borderColor: colors.error },
  input: { color: colors.ink, flex: 1, fontSize: 15, minHeight: 54, paddingVertical: 12 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
