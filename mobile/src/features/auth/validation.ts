import { Credentials, Registration } from './types';

export type AuthErrors = Partial<
  Record<'email' | 'password' | 'display_name' | 'confirmation' | 'role', string>
>;
const length = (value: string) => Array.from(value).length;

export function credentialErrors(data: Credentials): AuthErrors {
  const errors: AuthErrors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()) || length(data.email.trim()) > 254)
    errors.email = 'Enter a valid email address.';
  if (!length(data.password) || length(data.password) > 128)
    errors.password = 'Enter a password of 1 to 128 characters.';
  return errors;
}

export function registrationErrors(data: Registration, confirmation: string): AuthErrors {
  const errors = credentialErrors(data);
  if (!data.display_name.trim() || length(data.display_name.trim()) > 80)
    errors.display_name = 'Enter a name between 1 and 80 characters.';
  if (!errors.password && length(data.password) < 12)
    errors.password = 'Use at least 12 characters for your password.';
  if (data.password !== confirmation) errors.confirmation = 'The passwords do not match.';
  if (!['buyer', 'seller', 'broker'].includes(data.role))
    errors.role = 'Choose buyer, seller or broker.';
  return errors;
}

export const validateCredentials = (data: Credentials): string | null =>
  Object.values(credentialErrors(data))[0] ?? null;
export const validateRegistration = (data: Registration, confirmation: string): string | null =>
  Object.values(registrationErrors(data, confirmation))[0] ?? null;
