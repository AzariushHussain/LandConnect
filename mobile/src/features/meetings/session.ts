import { ApiError } from '../../api/client';
import type { MeetingHint } from '../chat/realtime';
import { Meeting, MeetingsApi, memberStatus } from './api';

type Api = Pick<
  MeetingsApi,
  'detail' | 'list' | 'accept' | 'invite' | 'remove' | 'decline' | 'leave' | 'end'
>;
type State = {
  id: string | null;
  meeting: Meeting | null;
  foreground: boolean;
  loading: boolean;
  busy: boolean;
  joining: boolean;
  joined: boolean;
  verified: boolean;
  error: string;
  notice: string;
  invitation: string | null;
};
const initial = (): State => ({
  id: null,
  meeting: null,
  foreground: false,
  loading: false,
  busy: false,
  joining: false,
  joined: false,
  verified: false,
  error: '',
  notice: '',
  invitation: null,
});
export class MeetingSession {
  private state = initial();
  private revision = 0;
  private discovery = 0;
  private reading = false;
  private listeners = new Set<() => void>();
  constructor(
    private readonly api: Api,
    private readonly actor: () => string | undefined,
    private readonly callBusy: () => boolean,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  reset = () => {
    this.revision++;
    this.discovery++;
    this.reading = false;
    this.state = initial();
    this.update({});
  };
  foreground = (foreground: boolean) => {
    this.update({ foreground });
    if (foreground) {
      void this.refresh();
      void this.discover();
    } else {
      const joined = this.state.joined || this.state.joining;
      this.update({ joined: false, joining: false, verified: false });
      if (joined && !this.state.busy) void this.change('leave');
    }
  };
  select = async (id: string) => {
    if (this.state.id !== id) {
      if (this.state.joined || this.state.joining || this.state.busy) return;
      this.revision++;
      this.reading = false;
      this.update({ id, meeting: null, verified: false, loading: true, error: '', notice: '' });
    }
    await this.refresh();
  };
  detach = (id: string) => {
    if (this.state.id === id && (this.state.joined || this.state.joining)) {
      this.update({ joined: false, joining: false });
      void this.change('leave').finally(() => this.clearDetail(id));
    } else this.clearDetail(id);
  };
  private clearDetail(id: string) {
    if (this.state.id !== id || this.state.busy || this.state.joined || this.state.joining) return;
    this.revision++;
    this.reading = false;
    this.update({
      id: null,
      meeting: null,
      verified: false,
      loading: false,
      error: '',
      notice: '',
    });
  }
  discover = async () => {
    if (!this.state.foreground || !this.actor()) return;
    const generation = ++this.discovery;
    try {
      const rows = await this.api.list(0, 'open', 'invited');
      if (generation === this.discovery && this.state.foreground)
        this.update({ invitation: rows[0]?.id ?? null });
    } catch {
      /* Keep the last invitation hint; the inbox exposes refresh failures. */
    }
  };
  hint = (hint: MeetingHint) => {
    if (hint.type === 'reconcile') {
      void this.discover();
      void this.refresh();
      return;
    }
    if (
      hint.type === 'meeting.invited' ||
      hint.type === 'meeting.member_removed' ||
      hint.type === 'meeting.ended'
    )
      void this.discover();
    if (hint.meeting_id !== this.state.id) return;
    if (
      hint.type === 'meeting.ended' ||
      hint.type === 'meeting.room_changed' ||
      (hint.type === 'meeting.member_removed' && hint.target_user_id === this.actor())
    )
      this.update({
        joined: false,
        verified: false,
        ...(hint.type === 'meeting.member_removed' && hint.target_user_id === this.actor()
          ? { meeting: null }
          : {}),
        notice: 'Meeting access or media room changed. Refresh before joining again.',
      });
    void this.refresh();
  };
  private confirmed(meeting: Meeting) {
    const previous = this.state.meeting;
    const changed = previous && previous.room_version !== meeting.room_version;
    const allowed =
      !meeting.ended_at &&
      !meeting.media_cleanup_pending &&
      memberStatus(meeting, this.actor() ?? '') === 'accepted';
    this.update({
      meeting,
      error: '',
      loading: false,
      verified: true,
      joined: allowed && !changed && this.state.joined,
      notice: changed
        ? 'The media room changed. Join again when cleanup has finished.'
        : this.state.notice,
    });
  }
  refresh = async () => {
    const id = this.state.id;
    if (!id || !this.state.foreground || this.state.busy || this.reading) return;
    const revision = this.revision;
    this.reading = true;
    try {
      const meeting = await this.api.detail(id);
      if (revision !== this.revision || !this.state.foreground) return;
      this.confirmed(meeting);
    } catch (error) {
      if (revision === this.revision)
        this.update({
          ...(error instanceof ApiError && error.status === 404 ? { meeting: null } : {}),
          loading: false,
          verified: false,
          joined: false,
          error: 'Could not verify meeting access. Media is stopped. Refresh to try again.',
        });
    } finally {
      if (revision === this.revision) this.reading = false;
    }
  };
  join = async () => {
    if (!this.state.id || !this.state.foreground || this.state.busy || this.state.joining) return;
    if (this.callBusy()) {
      this.update({ error: 'Finish the one-to-one call before joining a meeting.' });
      return;
    }
    const revision = ++this.revision;
    this.reading = false;
    this.update({ joining: true, joined: false, error: '' });
    try {
      const meeting = await this.api.detail(this.state.id);
      if (revision !== this.revision) return;
      this.confirmed(meeting);
      if (
        this.state.foreground &&
        !meeting.ended_at &&
        !meeting.media_cleanup_pending &&
        memberStatus(meeting, this.actor() ?? '') === 'accepted' &&
        !this.callBusy()
      )
        this.update({ joined: true, notice: '' });
      else
        this.update({ error: 'Accept the invitation and wait for room cleanup before joining.' });
    } catch {
      if (revision === this.revision) this.mediaFailed();
    } finally {
      if (revision === this.revision) this.update({ joining: false });
    }
  };
  mediaFailed = () =>
    this.update({
      joined: false,
      error: 'Meeting media stopped. Check permissions/connection, refresh and join again.',
    });
  change = async (
    action: 'accept' | 'invite' | 'remove' | 'decline' | 'leave' | 'end',
    target?: string,
  ) => {
    const id = this.state.id,
      meeting = this.state.meeting;
    if (!id || this.state.busy || this.state.joining || !meeting) return false;
    if (!this.state.verified && !['leave', 'end', 'decline'].includes(action)) return false;
    if (['invite', 'remove', 'end'].includes(action) && meeting.owner.id !== this.actor())
      return false;
    if (action === 'decline' && meeting.owner.id === this.actor()) return false;
    const revision = ++this.revision;
    this.reading = false;
    const stopMedia = ['remove', 'decline', 'leave', 'end'].includes(action);
    this.update({ busy: true, error: '', ...(stopMedia ? { joined: false } : {}) });
    let saved = false;
    try {
      let result: Meeting | void = undefined;
      if (action === 'invite') result = await this.api.invite(id, target!);
      else if (action === 'remove') await this.api.remove(id, target!);
      else result = await this.api[action](id);
      saved = true;
      if (revision !== this.revision) return false;
      if (action === 'decline')
        this.update({
          meeting: null,
          verified: false,
          invitation: null,
          notice:
            'Invitation declined or consent withdrawn. Access is revoked; media cleanup may still be pending.',
        });
      else {
        if (!result) result = await this.api.detail(id);
        if (revision !== this.revision) return false;
        this.confirmed(result);
        this.update({
          error: '',
          notice:
            action === 'leave'
              ? 'Media disconnected. Your accepted invitation remains; you can join again.'
              : 'Meeting updated.',
        });
      }
      void this.discover();
      return true;
    } catch {
      if (revision === this.revision)
        this.update({
          joined: false,
          verified: false,
          error: saved
            ? 'The action was saved, but refresh failed. Refresh before another change.'
            : 'Could not confirm this meeting action. Media is stopped. Refresh before retrying.',
        });
      return false;
    } finally {
      if (revision === this.revision) this.update({ busy: false });
    }
  };
}
