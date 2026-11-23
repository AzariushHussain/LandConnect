import { ApiClient, ApiError, RequestOptions } from '../../api/client';
import type { ChatSession } from '../chat/api';
import { Person, person, row, uuid } from '../chat/types';
import { CallKind } from '../calls/api';
import { mediaToken } from '../media/token';

export type Member = { user: Person; status: 'invited' | 'accepted' | 'declined' | 'removed' };
export type Meeting = {
  id: string;
  client_id: string | null;
  conversation_id: string | null;
  owner: Person;
  title: string;
  kind: CallKind;
  created_at: string;
  ended_at: string | null;
  room_version: number;
  media_cleanup_pending: boolean;
  members: Member[];
};
export const currentMembers = (meeting: Meeting) =>
  meeting.members.filter((m) => m.status === 'invited' || m.status === 'accepted');
export const memberStatus = (meeting: Meeting, actor: string) =>
  meeting.members.find((m) => m.user.id === actor)?.status;
export function meetingTitle(value: string) {
  const title = value.trim();
  if (!title || title.length > 150)
    throw new Error('Enter a meeting title of 1 to 150 characters.');
  return title;
}
export function meetingDto(value: unknown, actor: string): Meeting {
  const data = row(value),
    owner = person(data.owner);
  if (
    typeof data.id !== 'string' ||
    !uuid(data.id) ||
    !(data.client_id === null || (typeof data.client_id === 'string' && uuid(data.client_id))) ||
    !(
      data.conversation_id == null ||
      (typeof data.conversation_id === 'string' && uuid(data.conversation_id))
    ) ||
    typeof data.title !== 'string' ||
    meetingTitle(data.title) !== data.title ||
    !['audio', 'video'].includes(String(data.kind)) ||
    typeof data.created_at !== 'string' ||
    !Number.isFinite(Date.parse(data.created_at)) ||
    !(
      data.ended_at === null ||
      (typeof data.ended_at === 'string' && Number.isFinite(Date.parse(data.ended_at)))
    ) ||
    !Number.isSafeInteger(data.room_version) ||
    (data.room_version as number) < 1 ||
    typeof data.media_cleanup_pending !== 'boolean' ||
    !Array.isArray(data.members)
  )
    throw new Error('Could not verify this meeting. Refresh before continuing.');
  const members = data.members.map((value): Member => {
    const member = row(value);
    if (!['invited', 'accepted', 'declined', 'removed'].includes(String(member.status)))
      throw new Error('Invalid meeting membership.');
    return { user: person(member.user), status: member.status as Member['status'] };
  });
  if (
    new Set(members.map((m) => m.user.id)).size !== members.length ||
    members.find((m) => m.user.id === owner.id)?.status !== 'accepted' ||
    !members.some((m) => m.user.id === actor && ['invited', 'accepted'].includes(m.status)) ||
    members.filter((m) => ['invited', 'accepted'].includes(m.status)).length > 50
  )
    throw new Error('Could not verify meeting access.');
  return {
    id: data.id,
    client_id: data.client_id,
    conversation_id: (data.conversation_id as string | null | undefined) ?? null,
    owner,
    title: data.title,
    kind: data.kind as CallKind,
    created_at: data.created_at,
    ended_at: data.ended_at,
    room_version: data.room_version as number,
    media_cleanup_pending: data.media_cleanup_pending,
    members,
  };
}
export type MeetingAttempt = {
  client_id: string;
  title: string;
  kind: CallKind;
  member_ids: string[];
};
export class MeetingsApi {
  constructor(
    private readonly client: ApiClient,
    private readonly session: ChatSession,
    private readonly development = false,
  ) {}
  private id(id: string) {
    if (!uuid(id)) throw new Error('Invalid meeting or participant.');
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
        throw new ApiError(403, 'Meeting permissions or privacy settings prevent this action.');
      if (error instanceof ApiError && error.status === 404)
        throw new ApiError(404, 'This meeting or account is no longer available.');
      throw error;
    }
  }
  async list(offset = 0, status: 'open' | 'ended' = 'open', invitation?: 'invited') {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000 ||
      !['open', 'ended'].includes(status)
    )
      throw new Error('Invalid meeting page.');
    const { value, actor } = await this.request(
      `/meetings?limit=20&offset=${offset}&status=${status}${invitation ? '&invitation=invited' : ''}`,
    );
    const page = row(value);
    if (
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      page.limit !== 20 ||
      page.offset !== offset
    )
      throw new Error('Invalid meeting list.');
    const items = page.items.map((value) => meetingDto(value, actor));
    if (
      new Set(items.map((m) => m.id)).size !== items.length ||
      items.some(
        (m) =>
          (status === 'open' ? m.ended_at !== null : m.ended_at === null) ||
          (invitation && memberStatus(m, actor) !== 'invited'),
      )
    )
      throw new Error('Invalid meeting list.');
    return items;
  }
  private async response(path: string, options: RequestOptions = {}, id?: string) {
    const { value, actor } = await this.request(path, options);
    const meeting = meetingDto(value, actor);
    if (id && meeting.id !== id) throw new Error('Mismatched meeting.');
    return meeting;
  }
  detail(id: string) {
    return this.response(`/meetings/${this.id(id)}`, {}, id);
  }
  async groupCall(attempt: { client_id: string; conversation_id: string; kind: CallKind }) {
    this.id(attempt.client_id);
    this.id(attempt.conversation_id);
    if (!['audio', 'video'].includes(attempt.kind))
      throw new Error('Choose an audio or video call.');
    const call = await this.response(`/conversations/${attempt.conversation_id}/calls`, {
      method: 'POST',
      body: { client_id: attempt.client_id, kind: attempt.kind },
    });
    if (call.conversation_id !== attempt.conversation_id || call.kind !== attempt.kind)
      throw new Error('Could not verify the group call. Retry the same attempt.');
    return call;
  }
  async create(attempt: MeetingAttempt) {
    this.id(attempt.client_id);
    if (
      !['audio', 'video'].includes(attempt.kind) ||
      attempt.title !== meetingTitle(attempt.title) ||
      !Array.isArray(attempt.member_ids) ||
      !attempt.member_ids.length ||
      attempt.member_ids.length > 49 ||
      new Set(attempt.member_ids).size !== attempt.member_ids.length ||
      attempt.member_ids.includes(this.session.access()?.user.id ?? '')
    )
      throw new Error('Choose a title, audio/video and 1 to 49 other people.');
    attempt.member_ids.forEach((id) => this.id(id));
    const meeting = await this.response('/meetings', { method: 'POST', body: attempt });
    if (
      meeting.client_id !== attempt.client_id ||
      meeting.title !== attempt.title ||
      meeting.kind !== attempt.kind ||
      meeting.owner.id !== this.session.access()?.user.id
    )
      throw new Error('Could not verify the created meeting. Retry the same attempt.');
    return meeting;
  }
  async accept(id: string) {
    const meeting = await this.response(`/meetings/${this.id(id)}/accept`, { method: 'POST' }, id);
    if (meeting.ended_at || memberStatus(meeting, this.session.access()!.user.id) !== 'accepted')
      throw new Error('Acceptance was not confirmed. Refresh.');
    return meeting;
  }
  async invite(id: string, target: string) {
    const meeting = await this.response(
      `/meetings/${this.id(id)}/members`,
      { method: 'POST', body: { user_id: this.id(target) } },
      id,
    );
    if (meeting.ended_at || !currentMembers(meeting).some((m) => m.user.id === target))
      throw new Error('Invitation was not confirmed. Refresh.');
    return meeting;
  }
  async remove(id: string, target: string) {
    await this.request(`/meetings/${this.id(id)}/members/${this.id(target)}`, {
      method: 'DELETE',
      emptyResponse: true,
    });
  }
  async decline(id: string) {
    await this.request(`/meetings/${this.id(id)}/decline`, { method: 'POST', emptyResponse: true });
  }
  async leave(id: string) {
    await this.request(`/meetings/${this.id(id)}/leave`, { method: 'POST', emptyResponse: true });
  }
  async end(id: string) {
    const meeting = await this.response(`/meetings/${this.id(id)}/end`, { method: 'POST' }, id);
    if (!meeting.ended_at) throw new Error('Meeting end was not confirmed. Refresh.');
    return meeting;
  }
  async token(id: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid room version.');
    const { value } = await this.request(`/meetings/${this.id(id)}/token`, { method: 'POST' });
    return mediaToken(value, `meeting-${id}-${version}`, this.development);
  }
}
