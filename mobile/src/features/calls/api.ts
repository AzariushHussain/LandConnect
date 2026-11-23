import { ApiClient, ApiError, RequestOptions } from '../../api/client';
import { validateApiUrl } from '../../config/api-url';
import type { ChatSession } from '../chat/api';
import { person, Person, row, uuid } from '../chat/types';

export type CallKind = 'audio' | 'video';
export const statuses = [
  'ringing',
  'accepted',
  'rejected',
  'cancelled',
  'missed',
  'ended',
] as const;
export type CallStatus = (typeof statuses)[number];
export type Call = {
  id: string;
  client_id: string | null;
  caller: Person;
  callee: Person;
  kind: CallKind;
  status: CallStatus;
  created_at: string;
  expires_at: string;
  media_cleanup_pending: boolean;
};
export const active = (call: Call | null) =>
  call?.status === 'ringing' || call?.status === 'accepted';
export function callDto(value: unknown, actor: string): Call {
  const data = row(value);
  const caller = person(data.caller),
    callee = person(data.callee);
  if (
    typeof data.id !== 'string' ||
    !uuid(data.id) ||
    !(data.client_id === null || (typeof data.client_id === 'string' && uuid(data.client_id))) ||
    caller.id === callee.id ||
    ![caller.id, callee.id].includes(actor) ||
    !['audio', 'video'].includes(String(data.kind)) ||
    !statuses.includes(data.status as CallStatus) ||
    typeof data.created_at !== 'string' ||
    !Number.isFinite(Date.parse(data.created_at)) ||
    typeof data.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    typeof data.media_cleanup_pending !== 'boolean'
  )
    throw new Error('Could not verify this call. Refresh before continuing.');
  return {
    id: data.id,
    client_id: data.client_id,
    caller,
    callee,
    kind: data.kind as CallKind,
    status: data.status as CallStatus,
    created_at: data.created_at,
    expires_at: data.expires_at,
    media_cleanup_pending: data.media_cleanup_pending,
  };
}
export function roomToken(value: unknown, id: string, development: boolean) {
  const data = row(value);
  if (
    typeof data.url !== 'string' ||
    typeof data.token !== 'string' ||
    !data.token ||
    data.token.length > 16384 ||
    data.room !== `call-${id}` ||
    !Number.isInteger(data.expires_in) ||
    (data.expires_in as number) < 1 ||
    (data.expires_in as number) > 3600
  )
    throw new Error('Could not verify media access.');
  const url = new URL(data.url);
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Invalid media connection.');
  const origin = new URL(url);
  origin.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  validateApiUrl(origin.toString(), development);
  return { url: url.toString(), token: data.token, room: data.room as string };
}
export type CallAttempt = { client_id: string; callee_id: string; kind: CallKind };
export class CallsApi {
  constructor(
    private readonly client: ApiClient,
    private readonly session: ChatSession,
    private readonly development = false,
  ) {}
  private id(id: string) {
    if (!uuid(id)) throw new Error('Invalid call or participant.');
    return id;
  }
  private async request(path: string, options: RequestOptions = {}) {
    const access = this.session.access();
    if (!access) {
      this.session.checkExpiry();
      throw new ApiError(401, 'Please sign in again.');
    }
    try {
      const value = await this.client.request<unknown>(path, { ...options, token: access.token });
      if (this.session.access()?.token !== access.token)
        throw new ApiError(401, 'Your session changed. Please sign in again.');
      return { value, actor: access.user.id };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        await this.session.rejectToken(access.token);
      if (error instanceof ApiError && error.status === 403)
        throw new ApiError(403, 'Privacy settings or call permissions prevent this action.');
      if (error instanceof ApiError && error.status === 404)
        throw new ApiError(404, 'This call or account is no longer available.');
      throw error;
    }
  }
  async list(status: 'ringing' | 'accepted') {
    const { value, actor } = await this.request(`/calls?limit=20&offset=0&status=${status}`);
    const page = row(value);
    if (
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      page.offset !== 0 ||
      page.limit !== 20
    )
      throw new Error('Could not verify active calls.');
    const calls = page.items.map((item) => callDto(item, actor));
    if (
      calls.some((call) => call.status !== status) ||
      new Set(calls.map((call) => call.id)).size !== calls.length
    )
      throw new Error('Could not verify active calls.');
    return calls;
  }
  async detail(id: string) {
    const { value, actor } = await this.request(`/calls/${this.id(id)}`);
    const call = callDto(value, actor);
    if (call.id !== id) throw new Error('Mismatched call.');
    return call;
  }
  async create(attempt: CallAttempt) {
    this.id(attempt.client_id);
    this.id(attempt.callee_id);
    if (!['audio', 'video'].includes(attempt.kind)) throw new Error('Choose audio or video.');
    const { value, actor } = await this.request('/calls', { method: 'POST', body: attempt });
    const call = callDto(value, actor);
    if (
      call.caller.id !== actor ||
      call.callee.id !== attempt.callee_id ||
      call.client_id !== attempt.client_id ||
      call.kind !== attempt.kind
    )
      throw new Error('Mismatched outgoing call. Retry the same attempt.');
    return call;
  }
  async change(id: string, action: 'accept' | 'reject' | 'cancel' | 'end') {
    if (!['accept', 'reject', 'cancel', 'end'].includes(action))
      throw new Error('Invalid call action.');
    const { value, actor } = await this.request(`/calls/${this.id(id)}/${action}`, {
      method: 'POST',
    });
    const call = callDto(value, actor);
    if (call.id !== id) throw new Error('Mismatched call.');
    const expected = { accept: 'accepted', reject: 'rejected', cancel: 'cancelled', end: 'ended' }[
      action
    ];
    if (call.status !== expected)
      throw new Error('Could not confirm the requested call action. Refresh before retrying.');
    return call;
  }
  async token(id: string) {
    const { value } = await this.request(`/calls/${this.id(id)}/token`, { method: 'POST' });
    return roomToken(value, id, this.development);
  }
}
