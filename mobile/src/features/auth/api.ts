import { ApiClient, ApiError } from '../../api/client';
import { Credentials, isUser, Registration, TokenResponse, User } from './types';

export class AuthApi {
  constructor(private readonly client: ApiClient) {}

  async login(credentials: Credentials): Promise<TokenResponse> {
    const value = await this.client.request<TokenResponse>('/auth/login', { body: credentials });
    if (
      typeof value?.access_token !== 'string' ||
      !value.access_token ||
      value.token_type !== 'bearer' ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0 ||
      value.expires_in > 86400
    ) {
      throw new Error('The server returned an invalid session. Please try again.');
    }
    return value;
  }

  async me(token: string): Promise<User> {
    const value = await this.client.request<unknown>('/users/me', { token });
    if (!isUser(value)) throw new Error('Could not verify your account. Please try again.');
    return value;
  }

  async register(registration: Registration): Promise<void> {
    try {
      await this.client.request('/auth/register', { body: registration });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409)
        throw new ApiError(409, 'This email is already registered. Please sign in.');
      throw error;
    }
  }
}
