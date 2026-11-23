import { ApiError } from '../../api/client';
import { active, Call, CallAttempt, CallKind, CallsApi } from './api';

type State = {
  call: Call | null;
  attempt: CallAttempt | null;
  busy: boolean;
  verified: boolean;
  joined: boolean;
  foreground: boolean;
  error: string;
};
type Api = Pick<CallsApi, 'list' | 'detail' | 'create' | 'change'>;
export class CallController {
  private state: State = {
    call: null,
    attempt: null,
    busy: false,
    verified: false,
    joined: false,
    foreground: false,
    error: '',
  };
  private listeners = new Set<() => void>();
  private revision = 0;
  private reading = false;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(
    private readonly api: Api,
    private readonly actor: () => string | undefined,
    private readonly random: () => string,
  ) {}
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  reset = () => {
    this.revision++;
    this.reading = false;
    this.update({
      call: null,
      attempt: null,
      busy: false,
      verified: false,
      joined: false,
      foreground: false,
      error: '',
    });
  };
  foreground = (foreground: boolean) => {
    this.update({ foreground });
    if (foreground) void this.refresh();
    else {
      this.update({ joined: false, verified: false });
      if (active(this.state.call)) void this.finish();
    }
  };
  hint = (id?: string, terminal = false) => {
    if (terminal && this.state.call?.id === id) this.update({ verified: false, joined: false });
    void this.refresh();
  };
  refresh = async () => {
    if (!this.state.foreground || this.state.busy || this.reading || !this.actor()) return;
    this.reading = true;
    const revision = this.revision;
    try {
      let call = this.state.call;
      if (active(call)) call = await this.api.detail(call!.id);
      else {
        const [accepted, ringing] = await Promise.all([
          this.api.list('accepted'),
          this.api.list('ringing'),
        ]);
        const candidate = accepted[0] ?? ringing[0];
        if (candidate) call = await this.api.detail(candidate.id);
        else if (call?.media_cleanup_pending) call = await this.api.detail(call.id);
      }
      if (revision !== this.revision || !this.state.foreground) return;
      const same = call?.id === this.state.call?.id;
      this.update({
        call,
        verified: true,
        joined: same && call?.status === 'accepted' && this.state.joined,
        attempt:
          call?.client_id && call.client_id === this.state.attempt?.client_id
            ? null
            : this.state.attempt,
        error: '',
      });
    } catch (error) {
      if (revision === this.revision)
        this.update({
          ...(error instanceof ApiError && error.status === 404 ? { call: null } : {}),
          verified: false,
          joined: false,
          error: 'Could not confirm call status. Media is stopped. Refresh to try again.',
        });
    } finally {
      if (revision === this.revision) this.reading = false;
    }
  };
  start = async (callee: string, kind: CallKind) => {
    if (this.state.busy || active(this.state.call) || this.state.attempt || !this.state.foreground)
      return;
    this.update({ attempt: { client_id: this.random(), callee_id: callee, kind }, joined: false });
    await this.retry();
  };
  retry = async () => {
    const attempt = this.state.attempt;
    if (!attempt || this.state.busy || !this.state.foreground) return;
    const revision = ++this.revision;
    this.reading = false;
    this.update({ busy: true, error: '' });
    try {
      const call = await this.api.create(attempt);
      if (revision !== this.revision) return;
      this.update({ call, attempt: null, verified: true });
      if (!this.state.foreground && active(call)) {
        this.update({ busy: false });
        await this.finish();
      }
    } catch (error) {
      if (revision === this.revision)
        this.update({
          attempt:
            error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)
              ? null
              : attempt,
          error:
            error instanceof ApiError
              ? error.message
              : 'Could not confirm the call. Retry the same attempt; it may already exist.',
        });
    } finally {
      if (revision === this.revision) this.update({ busy: false });
    }
  };
  accept = async () => {
    const call = this.state.call;
    if (
      !call ||
      call.status !== 'ringing' ||
      call.callee.id !== this.actor() ||
      !this.state.foreground ||
      this.state.busy
    )
      return;
    await this.change('accept');
  };
  join = async () => {
    await this.refresh();
    if (
      this.state.foreground &&
      this.state.verified &&
      !this.state.busy &&
      this.state.call?.status === 'accepted'
    )
      this.update({ joined: true });
  };
  mediaFailed = () =>
    this.update({
      joined: false,
      error:
        'Media could not connect. Check camera/microphone permissions and the media server, then retry joining.',
    });
  finish = async () => {
    this.update({ joined: false });
    const call = this.state.call;
    if (!call || !active(call) || this.state.busy) return;
    await this.change(
      call.status === 'accepted' ? 'end' : call.caller.id === this.actor() ? 'cancel' : 'reject',
    );
  };
  private async change(action: 'accept' | 'reject' | 'cancel' | 'end') {
    const call = this.state.call!;
    const revision = ++this.revision;
    this.reading = false;
    this.update({ busy: true, verified: false, error: '' });
    try {
      let result: Call;
      try {
        result = await this.api.change(call.id, action);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 409)) throw error;
        result = await this.api.detail(call.id);
        if (action !== 'accept' && result.status === 'accepted')
          result = await this.api.change(call.id, 'end');
      }
      if (revision !== this.revision) return;
      this.update({ call: result, verified: true, joined: false });
      if (!this.state.foreground && active(result)) {
        this.update({ busy: false });
        await this.finish();
      }
    } catch {
      if (revision === this.revision)
        this.update({
          verified: false,
          joined: false,
          error:
            'Could not confirm this action. Media is stopped. Refresh and retry the call action.',
        });
    } finally {
      if (revision === this.revision) this.update({ busy: false });
    }
  }
}
