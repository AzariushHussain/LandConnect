import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { authApi, session } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Brand, Field, Heading, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ApiError } from '../../api/client';
import { Role } from './types';
import { validateCredentials, validateRegistration } from './validation';

type Props = { registering: boolean; initialEmail?: string; registered?: boolean };

export function AuthScreen({ registering, initialEmail = '', registered = false }: Props) {
  const state = useSession();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('buyer');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit() {
    if (submitting.current) return;
    const credentials = { email: email.trim().toLowerCase(), password };
    const registration = { ...credentials, display_name: name.trim(), role };
    const invalid = registering
      ? validateRegistration(registration, confirmation)
      : validateCredentials(credentials);
    if (invalid) {
      setError(invalid);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      if (registering) {
        await authApi.register(registration);
        if (mounted.current)
          router.dismissTo({
            pathname: '/sign-in',
            params: { email: credentials.email, registered: 'true' },
          });
      } else {
        await session.signIn(credentials);
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          !registering && failure instanceof ApiError && failure.status === 401
            ? 'Incorrect email or password.'
            : failure instanceof Error
              ? failure.message
              : 'Please try again.',
        );
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setBusy(false);
        setPassword('');
        setConfirmation('');
      }
    }
  }

  return (
    <Screen>
      <Brand />
      <Heading
        title={registering ? 'Find your place.' : 'Welcome back.'}
        detail={
          registering
            ? 'Create your account and connect with the land community.'
            : 'Sign in to your LandConnect account.'
        }
      />
      {registered && <Notice>Your account is ready. Sign in to continue.</Notice>}
      {!registering && state.status === 'signedOut' && state.message && (
        <Notice>{state.message}</Notice>
      )}
      {registering && (
        <Field
          label="Your name"
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoComplete="name"
          editable={!busy}
        />
      )}
      <Field
        label="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        maxLength={254}
        editable={!busy}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={registering ? 'new-password' : 'current-password'}
        textContentType={registering ? 'newPassword' : 'password'}
        maxLength={128}
        editable={!busy}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: visible }}
        onPress={() => setVisible(!visible)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>{visible ? 'Hide password' : 'Show password'}</Text>
      </Pressable>
      {registering && (
        <>
          <Notice>Use 12 or more characters.</Notice>
          <Field
            label="Confirm password"
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={128}
            editable={!busy}
          />
          <Text style={styles.label}>I am a</Text>
          <View style={styles.roles}>
            {(['buyer', 'seller', 'broker'] as const).map((item) => (
              <Pressable
                key={item}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityLabel={item}
                accessibilityState={{ checked: item === role, disabled: busy }}
                onPress={() => setRole(item)}
                style={[styles.role, role === item && styles.selected]}
              >
                <Text style={[styles.roleLabel, role === item && { color: '#FFFFFF' }]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
      <Action
        label={registering ? 'Create account' : 'Sign in'}
        onPress={() => void submit()}
        busy={busy}
      />
      <Action
        label={registering ? 'Already a member? Sign in' : 'New here? Create an account'}
        secondary
        disabled={busy}
        onPress={() => (registering ? router.dismissTo('/sign-in') : router.push('/register'))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  toggleText: { color: colors.green, fontWeight: '600', fontSize: 14 },
  label: { color: colors.ink, fontWeight: '600', fontSize: 14 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  role: {
    padding: 14,
    borderRadius: 12,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.green, borderColor: colors.green },
  roleLabel: { textTransform: 'capitalize', fontWeight: '600', color: colors.ink, fontSize: 15 },
});
