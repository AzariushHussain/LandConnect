import { ApiError } from '../../api/client';
import type { CallKind } from './api';
import { memberStatus, Meeting, MeetingsApi } from '../meetings/api';
import type { MeetingSession } from '../meetings/session';

type Attempt = { client_id: string; conversation_id: string; kind: CallKind };
export class GroupCallController {
  private state = { busy: false, attempt: null as Attempt | null, error: '' };
  private revision = 0;
  private starting = false;
  private listeners = new Set<() => void>();
  constructor(
    private readonly api: Pick<MeetingsApi, 'groupCall' | 'end' | 'leave'>,
    private readonly media: MeetingSession,
    private readonly actor: () => string | undefined,
    private readonly random: () => string,
    private readonly otherCallBusy: () => boolean,
    private readonly prepare: (kind: CallKind) => Promise<void>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  reset = () => {
    this.revision++;
    this.starting = false;
    this.update({ busy: false, attempt: null, error: '' });
  };
  cancelStart = () => {
    if (!this.starting) return;
    this.revision++;
    this.starting = false;
    this.update({ busy: false });
  };
  private available() {
    const state = this.media.getSnapshot();
    return state.foreground && !state.busy && !state.joining && !this.otherCallBusy();
  }
  start = async (conversation_id: string, kind: CallKind) => {
    if (this.state.busy) return null;
    if (!this.available() || this.media.getSnapshot().joined) {
      this.update({ error: 'Finish your current call or media session first.' });
      return null;
    }
    if (
      this.state.attempt &&
      (this.state.attempt.conversation_id !== conversation_id || this.state.attempt.kind !== kind)
    ) {
      this.update({ error: 'Retry the previous group call before starting a different call.' });
      return null;
    }
    const attempt = this.state.attempt ?? { client_id: this.random(), conversation_id, kind };
    const revision = ++this.revision,
      actor = this.actor();
    this.starting = true;
    this.update({ busy: true, error: '' });
    let sent = false;
    try {
      await this.prepare(kind);
      if (
        revision !== this.revision ||
        !actor ||
        actor !== this.actor() ||
        !this.available() ||
        this.media.getSnapshot().joined
      )
        return null;
      this.update({ attempt });
      sent = true;
      const call = await this.api.groupCall(attempt);
      if (revision !== this.revision) {
        if (
          this.revision === revision + 1 &&
          actor === this.actor() &&
          call.owner.id === actor &&
          !call.ended_at
        ) {
          await this.api.end(call.id);
          if (this.revision === revision + 1) this.update({ attempt: null });
        }
        return null;
      }
      this.update({ attempt: null });
      if (!this.available()) {
        if (call.owner.id === actor && !call.ended_at) await this.api.end(call.id);
        return null;
      }
      const connected = await this.connect(call.id, revision, actor);
      if (
        this.revision === revision + 1 &&
        actor === this.actor() &&
        this.media.getSnapshot().id === call.id
      )
        await this.media.change(call.owner.id === actor ? 'end' : 'leave');
      return connected;
    } catch (error) {
      if (revision === this.revision)
        this.update({
          error: error instanceof Error ? error.message : 'Could not start the group call.',
          ...(sent && error instanceof ApiError && error.status < 500 ? { attempt: null } : {}),
        });
      return null;
    } finally {
      if (revision === this.revision) {
        this.starting = false;
        this.update({ busy: false });
      }
    }
  };
  answer = async (id: string) => {
    if (this.state.busy) return null;
    if (!this.available()) {
      this.update({ error: 'Finish your current call or media request before answering.' });
      return null;
    }
    if (this.media.getSnapshot().joined && this.media.getSnapshot().id !== id) {
      this.update({ error: 'Finish your current media session first.' });
      return null;
    }
    const revision = ++this.revision,
      actor = this.actor();
    this.update({ busy: true, error: '' });
    try {
      await this.media.select(id, true);
      const call = this.media.getSnapshot().meeting;
      if (revision !== this.revision || !actor || !call?.conversation_id || call.id !== id)
        return null;
      await this.prepare(call.kind);
      if (revision !== this.revision || actor !== this.actor() || !this.available()) return null;
      return await this.connect(id, revision, actor);
    } catch (error) {
      if (revision === this.revision)
        this.update({
          error: error instanceof Error ? error.message : 'Could not answer the group call.',
        });
      return null;
    } finally {
      if (revision === this.revision) this.update({ busy: false });
    }
  };
  private async connect(id: string, revision: number, actor: string): Promise<Meeting | null> {
    await this.media.select(id, true);
    let state = this.media.getSnapshot();
    if (
      revision !== this.revision ||
      actor !== this.actor() ||
      !this.available() ||
      !state.verified ||
      !state.meeting?.conversation_id ||
      state.id !== id ||
      state.meeting.ended_at
    )
      return null;
    if (memberStatus(state.meeting, actor) === 'invited') await this.media.change('accept');
    if (revision !== this.revision || actor !== this.actor()) return null;
    state = this.media.getSnapshot();
    if (!state.foreground) {
      await (state.meeting?.owner.id === actor ? this.api.end(id) : this.api.leave(id));
      return null;
    }
    await this.media.join();
    if (revision !== this.revision || actor !== this.actor()) return null;
    state = this.media.getSnapshot();
    if (state.id !== id) return null;
    if (!state.joined)
      this.update({ error: state.error || 'Could not connect this call. Refresh and retry.' });
    return state.meeting;
  }
}
