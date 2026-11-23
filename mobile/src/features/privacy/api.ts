import { ApiClient, ApiError, RequestOptions } from '../../api/client';
import type { SessionController } from '../auth/session';
import { person, Person, row, uuid } from '../chat/types';

export type Preferences = { allow_messages: boolean; allow_calls: boolean };
export function preferences(value: unknown, actor: string): Preferences {
  const data = row(value);
  if (
    data.id !== actor ||
    typeof data.allow_messages !== 'boolean' ||
    typeof data.allow_calls !== 'boolean'
  )
    throw new Error('Could not verify your privacy settings. Refresh before making changes.');
  return { allow_messages: data.allow_messages, allow_calls: data.allow_calls };
}
export function privacyChanges(saved: Preferences, draft: Preferences): Partial<Preferences> {
  const changes: Partial<Preferences> = {};
  for (const key of ['allow_messages', 'allow_calls'] as const) {
    if (typeof draft[key] !== 'boolean' || typeof saved[key] !== 'boolean')
      throw new Error('Privacy preferences must be true or false.');
    if (draft[key] !== saved[key]) changes[key] = draft[key];
  }
  return changes;
}
export function blockedPage(value: unknown, actor: string, offset: number): Person[] {
  const page = row(value);
  if (
    !Array.isArray(page.items) ||
    page.items.length > 20 ||
    page.offset !== offset ||
    page.limit !== 20
  )
    throw new Error('Invalid blocked accounts list. Refresh to try again.');
  const items = page.items.map(person);
  if (
    items.some((peer) => peer.id === actor) ||
    new Set(items.map((peer) => peer.id)).size !== items.length
  )
    throw new Error('Invalid blocked accounts list. Refresh to try again.');
  return items;
}
export type PrivacySession = Pick<
  SessionController,
  'access' | 'checkExpiry' | 'rejectToken' | 'updatePrivacy'
>;
export class PrivacyApi {
  private revision = 0;
  constructor(
    private readonly client: ApiClient,
    private readonly session: PrivacySession,
  ) {}
  private async request<T>(path: string, options: RequestOptions = {}) {
    const access = this.session.access();
    if (!access) {
      this.session.checkExpiry();
      throw new ApiError(401, 'Please sign in again.');
    }
    try {
      const value = await this.client.request<T>(path, { ...options, token: access.token });
      if (this.session.access()?.token !== access.token)
        throw new ApiError(401, 'Your session changed. Please sign in again.');
      return { value, token: access.token, actor: access.user.id };
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401)
        await this.session.rejectToken(access.token);
      if (failure instanceof ApiError && failure.status === 404)
        throw new ApiError(404, 'This account is no longer available. Refresh and try again.');
      throw failure;
    }
  }
  private async profile(options?: RequestOptions) {
    const revision = ++this.revision;
    const { value, token, actor } = await this.request<unknown>(
      options ? '/users/me/privacy' : '/users/me',
      options,
    );
    const flags = preferences(value, actor);
    if (revision !== this.revision)
      throw new Error(
        'Privacy settings changed during this request. Refresh to see current settings.',
      );
    if (!this.session.updatePrivacy(token, actor, flags))
      throw new ApiError(401, 'Your session changed. Please sign in again.');
    return flags;
  }
  current() {
    return this.profile();
  }
  async save(changes: Partial<Preferences>) {
    if (
      !changes ||
      typeof changes !== 'object' ||
      !Object.keys(changes).length ||
      Object.keys(changes).some((key) => !['allow_messages', 'allow_calls'].includes(key)) ||
      Object.values(changes).some((value) => typeof value !== 'boolean')
    )
      throw new Error('Choose a valid privacy preference to change.');
    return this.profile({ method: 'PATCH', body: changes });
  }
  async blocks(offset = 0): Promise<Person[]> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      throw new Error('Invalid blocked accounts page.');
    const { value, actor } = await this.request<unknown>(
      `/users/me/blocks?limit=20&offset=${offset}`,
    );
    return blockedPage(value, actor, offset);
  }
  private target(id: string) {
    if (!uuid(id) || id === this.session.access()?.user.id)
      throw new Error('Choose another account to block or unblock.');
    return id;
  }
  async block(id: string) {
    await this.request<void>(`/users/me/blocks/${this.target(id)}`, { method: 'PUT' });
  }
  async unblock(id: string) {
    await this.request<void>(`/users/me/blocks/${this.target(id)}`, { method: 'DELETE' });
  }
}
