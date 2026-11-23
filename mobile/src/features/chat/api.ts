import { ApiClient, ApiError, RequestOptions } from '../../api/client';
import type { SessionController } from '../auth/session';
import {
  Conversation,
  conversation,
  groupName,
  HistoryQuery,
  history,
  message,
  person,
  row,
  uuid,
  validateBody,
} from './types';
export type ChatSession = Pick<SessionController, 'access' | 'checkExpiry' | 'rejectToken'>;
export class ChatApi {
  constructor(
    private readonly client: ApiClient,
    private readonly session: ChatSession,
  ) {}
  private id(value: string) {
    if (!uuid(value)) throw new Error('Invalid chat link or participant.');
    return value;
  }
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
      return { value, actor: access.user.id };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        await this.session.rejectToken(access.token);
      if (error instanceof ApiError && error.status === 404)
        throw new ApiError(404, 'This conversation or participant is no longer available to you.');
      if (error instanceof ApiError && error.status === 403)
        throw new ApiError(403, 'Privacy settings or group permissions prevent this action.');
      throw error;
    }
  }
  async list(offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      throw new Error('Invalid conversation page.');
    const { value, actor } = await this.request<unknown>(
      `/conversations?limit=20&offset=${offset}`,
    );
    const page = row(value);
    if (
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      page.limit !== 20 ||
      page.offset !== offset
    )
      throw new Error('Invalid conversation list.');
    return page.items.map((value) => conversation(value, actor));
  }
  async detail(id: string) {
    const { value, actor } = await this.request<unknown>(`/conversations/${this.id(id)}`);
    const chat = conversation(value, actor);
    if (chat.id !== id) throw new Error('Mismatched conversation.');
    return chat;
  }
  private async change(
    path: string,
    options: RequestOptions,
    expectedId?: string,
  ): Promise<Conversation> {
    try {
      const { value, actor } = await this.request<unknown>(path, options);
      const chat = conversation(value, actor);
      if (expectedId && chat.id !== expectedId) throw new Error('Mismatched conversation.');
      return chat;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw error;
      throw new Error(
        'Could not confirm this change. It may have succeeded. Refresh Chats or group information before trying again.',
      );
    }
  }
  async direct(recipient: string) {
    return this.change('/conversations/direct', { body: { recipient_id: this.id(recipient) } });
  }
  async searchPeople(query: string) {
    const term = query.trim();
    if (Array.from(term).length < 2 || Array.from(term).length > 254)
      throw new Error('Search with 2 to 254 characters.');
    const { value, actor } = await this.request<unknown>(
      `/users/search?${new URLSearchParams({ q: term })}`,
    );
    const page = row(value);
    if (
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      typeof page.has_more !== 'boolean' ||
      (page.has_more && page.items.length !== 20)
    )
      throw new Error('Invalid people search response. Try again.');
    const items = page.items.map(person);
    if (
      items.some((item) => item.id === actor) ||
      new Set(items.map((p) => p.id)).size !== items.length
    )
      throw new Error('Invalid people search response. Try again.');
    return { items, hasMore: page.has_more };
  }
  async group(name: string, members: string[]) {
    if (
      members.length < 1 ||
      members.length > 49 ||
      new Set(members).size !== members.length ||
      members.includes(this.session.access()?.user.id ?? '')
    )
      throw new Error('Select 1 to 49 other people, without duplicates.');
    return this.change('/conversations/groups', {
      body: { name: groupName(name), member_ids: members.map((id) => this.id(id)) },
    });
  }
  async rename(id: string, name: string) {
    return this.change(
      `/conversations/${this.id(id)}`,
      { method: 'PATCH', body: { name: groupName(name) } },
      id,
    );
  }
  async invite(id: string, user: string) {
    return this.change(
      `/conversations/${this.id(id)}/members`,
      { body: { user_id: this.id(user) } },
      id,
    );
  }
  async role(id: string, user: string, role: 'admin' | 'member') {
    if (!['admin', 'member'].includes(role)) throw new Error('Invalid group role.');
    return this.change(
      `/conversations/${this.id(id)}/members/${this.id(user)}`,
      { method: 'PATCH', body: { role } },
      id,
    );
  }
  async transfer(id: string, user: string) {
    return this.change(
      `/conversations/${this.id(id)}/ownership`,
      { body: { user_id: this.id(user) } },
      id,
    );
  }
  async remove(id: string, user?: string) {
    await this.request(`/conversations/${this.id(id)}/members/${user ? this.id(user) : 'me'}`, {
      method: 'DELETE',
    });
  }
  async history(id: string, query: HistoryQuery = {}) {
    if (
      (query.after !== undefined && query.before !== undefined) ||
      (query.after !== undefined &&
        (!Number.isInteger(query.after) || query.after < 0 || query.after > 2147483647)) ||
      (query.before !== undefined &&
        (!Number.isInteger(query.before) || query.before < 1 || query.before > 2147483647))
    )
      throw new Error('Invalid message cursor.');
    const params = new URLSearchParams({ limit: '50' });
    if (query.after !== undefined) params.set('after_id', String(query.after));
    if (query.before !== undefined) params.set('before_id', String(query.before));
    const { value } = await this.request<unknown>(
      `/conversations/${this.id(id)}/messages?${params}`,
    );
    return history(value, id, query);
  }
  async send(id: string, clientId: string, body: string) {
    const { value, actor } = await this.request<unknown>(`/conversations/${this.id(id)}/messages`, {
      body: { client_id: this.id(clientId), body: validateBody(body) },
    });
    const saved = message(value, id);
    if (saved.client_id !== clientId || saved.body !== body || saved.sender.id !== actor)
      throw new Error('Could not confirm this message. Retry the same message.');
    return saved;
  }
}
