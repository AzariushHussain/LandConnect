export type Role = 'buyer' | 'seller' | 'broker';

export type User = {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  allow_messages: boolean;
  allow_calls: boolean;
  created_at: string;
};

export type Credentials = { email: string; password: string };
export type Registration = Credentials & { display_name: string; role: Role };
export type TokenResponse = { access_token: string; token_type: 'bearer'; expires_in: number };
export type SavedSession = { token: string; expiresAt: number };

export function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.display_name === 'string' &&
    ['buyer', 'seller', 'broker'].includes(String(user.role)) &&
    typeof user.allow_messages === 'boolean' &&
    typeof user.allow_calls === 'boolean' &&
    typeof user.created_at === 'string'
  );
}

export function parseSavedSession(raw: string | null): SavedSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SavedSession;
    return value &&
      typeof value.token === 'string' &&
      value.token.length > 0 &&
      Number.isFinite(value.expiresAt)
      ? { token: value.token, expiresAt: value.expiresAt }
      : null;
  } catch {
    return null;
  }
}
