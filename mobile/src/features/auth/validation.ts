import { Credentials, Registration } from './types';

export function validateCredentials(data: Credentials): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()) || data.email.trim().length > 254)
    return 'Enter a valid email address.';
  if (!data.password.length || data.password.length > 128)
    return 'Enter a password of up to 128 characters.';
  return null;
}

export function validateRegistration(data: Registration, confirmation: string): string | null {
  const basic = validateCredentials(data);
  if (basic) return basic;
  if (!data.display_name.trim() || data.display_name.trim().length > 80)
    return 'Enter a name between 1 and 80 characters.';
  if (data.password.length < 12) return 'Use at least 12 characters for your password.';
  if (data.password !== confirmation) return 'The passwords do not match.';
  return null;
}
