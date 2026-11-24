import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInputInstance,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, usePreventRemove } from 'expo-router';
import { authApi, session } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Brand, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ApiError } from '../../api/client';
import { Role } from './types';
import { AuthErrors, credentialErrors, registrationErrors } from './validation';
import { AuthField } from './AuthField';

type Props = { registering: boolean; initialEmail?: string; registered?: boolean };
const roles = [
  {
    value: 'buyer',
    label: 'Buyer',
    icon: 'search-outline',
    detail: 'Find land and connect with owners.',
  },
  {
    value: 'seller',
    label: 'Seller',
    icon: 'home-outline',
    detail: 'Create and manage your land listings.',
  },
  {
    value: 'broker',
    label: 'Broker',
    icon: 'briefcase-outline',
    detail: 'Manage listings and connect with clients.',
  },
] as const;

export function AuthScreen({ registering, initialEmail = '', registered = false }: Props) {
  const state = useSession();
  const [email, setEmail] = useState(initialEmail),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [name, setName] = useState(''),
    [role, setRole] = useState<Role>('buyer'),
    [visible, setVisible] = useState(false),
    [confirmVisible, setConfirmVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [errors, setErrors] = useState<AuthErrors>({});
  const submitting = useRef(false),
    mounted = useRef(true);
  const nameInput = useRef<TextInputInstance>(null),
    emailInput = useRef<TextInputInstance>(null),
    passwordInput = useRef<TextInputInstance>(null),
    confirmationInput = useRef<TextInputInstance>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useFocusEffect(
    useCallback(
      () => () => {
        setPassword('');
        setConfirmation('');
        setVisible(false);
        setConfirmVisible(false);
      },
      [],
    ),
  );
  const disablePrevention = usePreventRemove(registering && busy, () =>
    Alert.alert('Creating your account', 'Please wait for the account request to finish.'),
  );
  function edited(field: keyof AuthErrors) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setError('');
  }
  async function submit() {
    if (submitting.current) return;
    const credentials = { email: email.trim().toLowerCase(), password };
    const registration = { ...credentials, display_name: name.trim(), role };
    const invalid = registering
      ? registrationErrors(registration, confirmation)
      : credentialErrors(credentials);
    setErrors(invalid);
    setError('');
    if (Object.keys(invalid).length) {
      if (invalid.display_name) nameInput.current?.focus();
      else if (invalid.email) emailInput.current?.focus();
      else if (invalid.password) passwordInput.current?.focus();
      else if (invalid.confirmation) confirmationInput.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    Keyboard.dismiss();
    try {
      if (registering) {
        await authApi.register(registration);
        if (mounted.current) {
          setBusy(false);
          disablePrevention();
          router.dismissTo({
            pathname: '/sign-in',
            params: { email: credentials.email, registered: 'true' },
          });
        }
      } else await session.signIn(credentials);
    } catch (failure) {
      if (mounted.current) {
        if (registering && failure instanceof ApiError && failure.status === 409) {
          setErrors({ email: failure.message });
          setError(failure.message);
        } else
          setError(
            !registering && failure instanceof ApiError && failure.status === 401
              ? 'Incorrect email or password.'
              : registering && (!(failure instanceof ApiError) || failure.status >= 500)
                ? 'Could not confirm account creation. Try signing in before submitting again.'
                : failure instanceof Error
                  ? failure.message
                  : 'Please try again.',
          );
      }
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setBusy(false);
        setPassword('');
        setConfirmation('');
        setVisible(false);
        setConfirmVisible(false);
      }
    }
  }
  function switchScreen() {
    if (submitting.current) return;
    setPassword('');
    setConfirmation('');
    const address = email.trim().toLowerCase();
    if (registering)
      router.dismissTo({ pathname: '/sign-in', params: { email: address, registered: 'false' } });
    else router.push({ pathname: '/register', params: { email: address } });
  }
  return (
    <Screen>
      <View style={styles.hero}>
        <Brand />
        <Text style={styles.title} accessibilityRole="header">
          {registering ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text style={styles.subtitle}>
          {registering
            ? 'Find land, list properties and connect with the right people.'
            : 'Sign in to explore land and stay connected.'}
        </Text>
      </View>
      {registered && (
        <View style={styles.success}>
          <Ionicons name="checkmark-circle-outline" color={colors.green} size={22} />
          <View style={styles.noticeCopy}>
            <Notice>Your account is ready. Sign in to continue.</Notice>
          </View>
        </View>
      )}
      {!registering && state.status === 'signedOut' && !!state.message && (
        <Notice>{state.message}</Notice>
      )}
      <View style={styles.form}>
        {registering && (
          <AuthField
            label="Display name"
            icon="person-outline"
            inputRef={nameInput}
            value={name}
            error={errors.display_name}
            placeholder="How others will see you"
            hint="Shown on your profile and in chats."
            onChangeText={(value) => {
              setName(value);
              edited('display_name');
            }}
            maxLength={160}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            editable={!busy}
            returnKeyType="next"
            onSubmitEditing={() => emailInput.current?.focus()}
          />
        )}
        <AuthField
          label="Email address"
          icon="mail-outline"
          inputRef={emailInput}
          value={email}
          error={errors.email}
          placeholder="you@example.com"
          onChangeText={(value) => {
            setEmail(value);
            edited('email');
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          maxLength={254}
          editable={!busy}
          returnKeyType="next"
          onSubmitEditing={() => passwordInput.current?.focus()}
        />
        <AuthField
          label="Password"
          icon="lock-closed-outline"
          inputRef={passwordInput}
          value={password}
          error={errors.password}
          hint={registering ? 'Use 12–128 characters. Spaces and symbols are welcome.' : undefined}
          placeholder={registering ? 'Create a password' : 'Enter your password'}
          onChangeText={(value) => {
            setPassword(value);
            edited('password');
            edited('confirmation');
          }}
          secureTextEntry={!visible}
          visible={visible}
          onVisibility={() => setVisible(!visible)}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={registering ? 'new-password' : 'current-password'}
          textContentType={registering ? 'newPassword' : 'password'}
          maxLength={256}
          editable={!busy}
          returnKeyType={registering ? 'next' : 'go'}
          onSubmitEditing={() => (registering ? confirmationInput.current?.focus() : void submit())}
        />
        {registering && (
          <>
            <AuthField
              label="Confirm password"
              icon="lock-closed-outline"
              inputRef={confirmationInput}
              value={confirmation}
              error={errors.confirmation}
              placeholder="Enter the password again"
              onChangeText={(value) => {
                setConfirmation(value);
                edited('confirmation');
              }}
              secureTextEntry={!confirmVisible}
              visible={confirmVisible}
              onVisibility={() => setConfirmVisible(!confirmVisible)}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              maxLength={256}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
            <View style={styles.roleSection}>
              <Text style={styles.label}>Choose your account type</Text>
              <View style={styles.roles} accessibilityRole="radiogroup">
                {roles.map((item) => (
                  <Pressable
                    key={item.value}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityLabel={item.label}
                    accessibilityHint={item.detail}
                    accessibilityState={{ checked: item.value === role, disabled: busy }}
                    onPress={() => {
                      setRole(item.value);
                      edited('role');
                    }}
                    style={[styles.role, item.value === role && styles.selected]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={22}
                      color={item.value === role ? colors.green : colors.muted}
                    />
                    <Text
                      style={[styles.roleLabel, item.value === role && { color: colors.green }]}
                    >
                      {item.label}
                    </Text>
                    {item.value === role && (
                      <Ionicons name="checkmark-circle" color={colors.green} size={16} />
                    )}
                  </Pressable>
                ))}
              </View>
              <Text style={styles.roleDetail}>
                {roles.find((item) => item.value === role)!.detail}
              </Text>
              {!!errors.role && <Notice error>{errors.role}</Notice>}
            </View>
          </>
        )}
        {!!error && (
          <View style={styles.error}>
            <Notice error>{error}</Notice>
          </View>
        )}
        <Action
          label={registering ? 'Create account' : 'Sign in'}
          onPress={() => void submit()}
          busy={busy}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>
          {registering ? 'Already have an account?' : 'New to LandConnect?'}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          onPress={switchScreen}
          style={styles.switchLink}
        >
          <Text style={[styles.link, busy && { opacity: 0.5 }]}>
            {registering ? 'Sign in' : 'Create account'}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 10, marginBottom: 4 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 37, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  form: { backgroundColor: colors.surface, padding: 20, borderRadius: 24, gap: 20 },
  success: {
    backgroundColor: colors.pale,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  noticeCopy: { flex: 1 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  roleSection: { gap: 10 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  role: {
    flexGrow: 1,
    flexBasis: 72,
    minHeight: 78,
    padding: 10,
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: '#FBFCFA',
  },
  selected: { borderColor: colors.green, backgroundColor: colors.pale },
  roleLabel: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  roleDetail: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  error: { borderRadius: 12, backgroundColor: '#FBEDED', padding: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  switchText: { color: colors.muted, fontSize: 13 },
  switchLink: { minHeight: 44, justifyContent: 'center' },
  link: { color: colors.green, fontSize: 14, fontWeight: '600' },
});
