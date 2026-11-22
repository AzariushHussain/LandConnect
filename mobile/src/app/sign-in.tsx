import { useLocalSearchParams } from 'expo-router';
import { AuthScreen } from '../features/auth/AuthScreen';

export default function SignInRoute() {
  const params = useLocalSearchParams<{ email?: string; registered?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const registered = params.registered === 'true';
  return (
    <AuthScreen
      key={`${email}:${registered}`}
      registering={false}
      initialEmail={email}
      registered={registered}
    />
  );
}
