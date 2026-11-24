import { AuthScreen } from '../features/auth/AuthScreen';
import { useLocalSearchParams } from 'expo-router';

export default function RegisterRoute() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const initialEmail = typeof email === 'string' ? email : '';
  return <AuthScreen key={initialEmail} registering initialEmail={initialEmail} />;
}
